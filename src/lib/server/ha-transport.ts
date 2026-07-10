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

// --- WebSocket Transport ---

type WSStateCallback = (entityId: string, newState: string, lastChanged: number) => void;

let wsConnection: WebSocket | null = null;
let wsMessageId = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const stateListeners = new Set<WSStateCallback>();
let subscribedEntities: string[] = [];

/**
 * Subscribe to live entity state changes via WebSocket.
 * Maintains a single shared connection; fans out to all listeners.
 * Returns an unsubscribe function.
 */
export function subscribeToStates(
	entityIds: string[],
	callback: WSStateCallback
): () => void {
	stateListeners.add(callback);
	subscribedEntities = [...new Set([...subscribedEntities, ...entityIds])];

	if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
		connectWebSocket();
	} else {
		sendSubscription();
	}

	return () => {
		stateListeners.delete(callback);
		if (stateListeners.size === 0) {
			disconnectWebSocket();
		}
	};
}

async function connectWebSocket() {
	if (wsConnection) return;

	const config = await getHAConfig();
	if (!config.url || !config.token) return;

	const wsUrl = config.url.replace(/^http/, 'ws') + '/api/websocket';
	wsConnection = new WebSocket(wsUrl);

	wsConnection.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		handleWSMessage(msg, config.token);
	};

	wsConnection.onclose = () => {
		wsConnection = null;
		scheduleReconnect();
	};

	wsConnection.onerror = () => {
		wsConnection?.close();
	};
}

function handleWSMessage(
	msg: { type: string; event?: { a?: Record<string, { s: string; lc: number }> } },
	token: string
) {
	switch (msg.type) {
		case 'auth_required':
			wsConnection?.send(JSON.stringify({ type: 'auth', access_token: token }));
			break;
		case 'auth_ok':
			sendSubscription();
			break;
		case 'event':
			handleStateEvent(msg);
			break;
	}
}

function sendSubscription() {
	if (!wsConnection || subscribedEntities.length === 0) return;
	wsMessageId++;
	wsConnection.send(JSON.stringify({
		id: wsMessageId,
		type: 'subscribe_entities',
		entity_ids: subscribedEntities
	}));
}

function handleStateEvent(msg: { event?: { a?: Record<string, { s: string; lc: number }> } }) {
	const changes = msg.event?.a;
	if (!changes) return;
	for (const [entityId, data] of Object.entries(changes)) {
		for (const listener of stateListeners) {
			listener(entityId, data.s, data.lc);
		}
	}
}

function disconnectWebSocket() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	if (wsConnection) {
		wsConnection.close();
		wsConnection = null;
	}
	subscribedEntities = [];
}

function scheduleReconnect() {
	if (stateListeners.size === 0) return;
	if (reconnectTimer) return;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connectWebSocket();
	}, 3000);
}

// --- Helpers ---

function assertConfigured(config: HAConfig): asserts config is HAConfig & { url: string; token: string } {
	if (!config.url || !config.token) {
		throw new Error('Home Assistant not configured. Go to Settings to connect.');
	}
}
