/**
 * Low-level Home Assistant transport layer.
 * Single source of truth for HA REST + WebSocket communication.
 * All HA modules build on this — never call HA APIs directly elsewhere.
 */

import { getHAConfig, type HAConfig } from './ha-config';
import { isDemoMode } from './demo';
import { getDemoHAStates, getDemoEntityState, getDemoHistory, DEMO_HA_API_INFO } from './demo/ha-data';

// --- Types ---

export interface HAEntityState {
	entity_id: string;
	state: string;
	attributes: Record<string, unknown>;
	last_changed: string;
	last_updated: string;
}

export interface HAApiInfo {
	message: string;
	version: string;
	location_name: string;
	installation_type?: string;
}

// --- REST Transport ---

/**
 * Low-level HA REST fetch. Loads config dynamically each call to pick up
 * config changes without restart.
 * @throws Error if HA is not configured or request fails.
 */
export async function haFetch<T = unknown>(path: string, options?: {
	method?: string;
	body?: unknown;
	params?: Record<string, string>;
	homeId?: number | null;
}): Promise<T> {
	if (isDemoMode()) {
		// Route demo requests based on path
		if (path === '/api/states') return getDemoHAStates() as T;
		if (path.startsWith('/api/states/')) {
			const entityId = path.replace('/api/states/', '');
			const state = getDemoEntityState(entityId);
			if (state) return state as T;
			throw new Error(`Demo: entity not found: ${entityId}`);
		}
		if (path === '/api/') return DEMO_HA_API_INFO as T;
		if (path.startsWith('/api/history/period')) {
			const entityId = options?.params?.filter_entity_id;
			if (entityId) return getDemoHistory(entityId) as T;
			return [[]] as T;
		}
		// Service calls in demo mode are no-ops
		if (path.startsWith('/api/services/')) return {} as T;
		return {} as T;
	}

	const config = await getHAConfig(options?.homeId);
	assertConfigured(config);

	const url = new URL(path, config.url);
	if (options?.params) {
		for (const [key, value] of Object.entries(options.params)) {
			url.searchParams.set(key, value);
		}
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10000);

	const resp = await fetch(url.toString(), {
		method: options?.method || 'GET',
		headers: {
			'Authorization': 'Bearer ' + config.token,
			'Content-Type': 'application/json'
		},
		body: options?.body ? JSON.stringify(options.body) : undefined,
		signal: controller.signal
	});
	clearTimeout(timeout);

	if (!resp.ok) {
		throw new Error(`HA API error: ${resp.status} ${resp.statusText}`);
	}
	return resp.json() as Promise<T>;
}

/**
 * Check whether HA is configured (URL + token present).
 * Does NOT test connectivity — use `testConnection()` for that.
 */
export async function isConfigured(homeId?: number | null): Promise<boolean> {
	if (isDemoMode()) return true;

	const config = await getHAConfig(homeId);
	return Boolean(config.url && config.token && config.enabled);
}

/**
 * Test actual connectivity to HA. Returns API info on success, null on failure.
 */
export async function testConnection(homeId?: number | null): Promise<HAApiInfo | null> {
	if (isDemoMode()) return DEMO_HA_API_INFO;

	try {
		const config = await getHAConfig(homeId);
		if (!config.url || !config.token) return null;

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000);

		const url = new URL('/api/', config.url);
		const resp = await fetch(url.toString(), {
			headers: {
				'Authorization': 'Bearer ' + config.token,
				'Content-Type': 'application/json'
			},
			signal: controller.signal
		});
		clearTimeout(timeout);
		if (!resp.ok) return null;
		return await resp.json() as HAApiInfo;
	} catch {
		return null;
	}
}

// --- WebSocket Transport (per-home) ---

export type WSConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'auth_error';
type WSStateCallback = (entityId: string, newState: string, lastChanged: number) => void;
type WSStatusCallback = (status: WSConnectionStatus) => void;

interface WSSession {
	connection: WebSocket | null;
	messageId: number;
	reconnectTimer: ReturnType<typeof setTimeout> | null;
	listeners: Set<WSStateCallback>;
	statusListeners: Set<WSStatusCallback>;
	entities: string[];
	homeId: number | null;
	status: WSConnectionStatus;
}

const wsSessions = new Map<string, WSSession>();

function wsKey(homeId: number | null): string {
	return homeId != null ? String(homeId) : 'default';
}

function getOrCreateSession(homeId: number | null): WSSession {
	const key = wsKey(homeId);
	let session = wsSessions.get(key);
	if (!session) {
		session = {
			connection: null,
			messageId: 0,
			reconnectTimer: null,
			listeners: new Set(),
			statusListeners: new Set(),
			entities: [],
			homeId: homeId ?? null,
			status: 'disconnected'
		};
		wsSessions.set(key, session);
	}
	return session;
}

function setWSStatus(session: WSSession, status: WSConnectionStatus) {
	if (session.status === status) return;
	session.status = status;
	for (const listener of session.statusListeners) {
		listener(status);
	}
}

/**
 * Get current WebSocket connection status for a home.
 */
export function getWSConnectionStatus(homeId: number | null): WSConnectionStatus {
	const session = wsSessions.get(wsKey(homeId));
	return session?.status ?? 'disconnected';
}

/**
 * Subscribe to WebSocket connection status changes for a home.
 * Returns an unsubscribe function.
 */
export function onWSStatusChange(callback: WSStatusCallback, homeId: number | null): () => void {
	const session = getOrCreateSession(homeId);
	session.statusListeners.add(callback);
	return () => { session.statusListeners.delete(callback); };
}

/**
 * Subscribe to live entity state changes via WebSocket.
 * Maintains one shared connection per home; fans out to all listeners for that home.
 * Returns an unsubscribe function.
 */
export function subscribeToStates(
	entityIds: string[],
	callback: WSStateCallback,
	homeId: number | null
): () => void {
	const session = getOrCreateSession(homeId);
	session.listeners.add(callback);
	const newEntities = entityIds.filter(id => !session.entities.includes(id));
	session.entities = [...new Set([...session.entities, ...entityIds])];

	if (!session.connection || session.connection.readyState !== WebSocket.OPEN) {
		connectWebSocket(session);
	} else if (newEntities.length > 0) {
		sendSubscription(session);
	}

	return () => {
		session.listeners.delete(callback);
		if (session.listeners.size === 0) {
			disconnectWebSocket(session);
			wsSessions.delete(wsKey(homeId));
		}
	};
}

/**
 * Update the set of subscribed entities without adding a new listener.
 * Useful when entity mappings change.
 */
export function updateSubscribedEntities(entityIds: string[], homeId: number | null): void {
	const session = wsSessions.get(wsKey(homeId));
	if (!session) return;
	session.entities = [...new Set(entityIds)];
	if (session.connection && session.connection.readyState === WebSocket.OPEN) {
		sendSubscription(session);
	}
}

async function connectWebSocket(session: WSSession) {
	if (session.connection) return;

	const config = await getHAConfig(session.homeId);
	if (!config.url || !config.token) {
		setWSStatus(session, 'disconnected');
		return;
	}

	setWSStatus(session, 'connecting');
	const wsUrl = config.url.replace(/^http/, 'ws') + '/api/websocket';

	try {
		session.connection = new WebSocket(wsUrl);
	} catch {
		setWSStatus(session, 'disconnected');
		scheduleReconnect(session);
		return;
	}

	session.connection.onmessage = (event) => {
		try {
			const msg = JSON.parse(String(event.data));
			handleWSMessage(msg, config.token, session);
		} catch { /* ignore parse errors */ }
	};

	session.connection.onclose = () => {
		session.connection = null;
		if (session.status !== 'auth_error') {
			setWSStatus(session, 'disconnected');
		}
		scheduleReconnect(session);
	};

	session.connection.onerror = () => {
		session.connection?.close();
	};
}

function handleWSMessage(
	msg: { type: string; event?: { a?: Record<string, { s: string; lc: number }> } },
	token: string,
	session: WSSession
) {
	switch (msg.type) {
		case 'auth_required':
			session.connection?.send(JSON.stringify({ type: 'auth', access_token: token }));
			break;
		case 'auth_ok':
			setWSStatus(session, 'connected');
			sendSubscription(session);
			break;
		case 'auth_invalid':
			setWSStatus(session, 'auth_error');
			session.connection?.close();
			break;
		case 'event':
			handleStateEvent(msg, session);
			break;
	}
}

function sendSubscription(session: WSSession) {
	if (!session.connection || session.entities.length === 0) return;
	session.messageId++;
	session.connection.send(JSON.stringify({
		id: session.messageId,
		type: 'subscribe_entities',
		entity_ids: session.entities
	}));
}

function handleStateEvent(
	msg: { event?: { a?: Record<string, { s: string; lc: number }> } },
	session: WSSession
) {
	const changes = msg.event?.a;
	if (!changes) return;
	for (const [entityId, data] of Object.entries(changes)) {
		for (const listener of session.listeners) {
			listener(entityId, data.s, data.lc);
		}
	}
}

function disconnectWebSocket(session: WSSession) {
	if (session.reconnectTimer) {
		clearTimeout(session.reconnectTimer);
		session.reconnectTimer = null;
	}
	if (session.connection) {
		session.connection.close();
		session.connection = null;
	}
	session.entities = [];
	setWSStatus(session, 'disconnected');
}

function scheduleReconnect(session: WSSession) {
	if (session.listeners.size === 0) return;
	if (session.reconnectTimer) return;
	session.reconnectTimer = setTimeout(() => {
		session.reconnectTimer = null;
		connectWebSocket(session);
	}, 3000);
}

// --- Helpers ---

function assertConfigured(config: HAConfig): asserts config is HAConfig & { url: string; token: string } {
	if (!config.url || !config.token) {
		throw new Error('Home Assistant not configured. Go to Settings to connect.');
	}
}
