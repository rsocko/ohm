/**
 * WebSocket-to-SSE bridge for real-time energy data.
 * Singleton that manages HA WebSocket subscriptions, caches last-known state,
 * and fans out updates to connected SSE clients.
 *
 * Primary: WebSocket push (~1s updates from HA).
 * Fallback: REST polling every 5s when WebSocket is disconnected.
 */

import {
	subscribeToStates,
	updateSubscribedEntities,
	getWSConnectionStatus,
	onWSStatusChange,
	haFetch,
	type WSConnectionStatus,
	type HAEntityState
} from './ha-transport';
import { getEntityMappings } from './energy-mappings';
import { getSolarReading, calculateCost, getCircuitReadings } from './ha-energy';
import { getSolarConfig } from './solar-config';
import type { LiveSSEData, CapacityAlert, CircuitReading, EntityMapping } from '$lib/types/energy';

// --- Types ---

export interface BridgeStatus {
	wsConnected: boolean;
	wsStatus: WSConnectionStatus;
	mode: 'websocket' | 'polling' | 'offline';
	clientCount: number;
	lastUpdate: string | null;
}

type SSEClient = (data: LiveSSEData) => void;
type StatusClient = (status: BridgeStatus) => void;

// --- Singleton State ---

let initialized = false;
let wsUnsubscribe: (() => void) | null = null;
let wsStatusUnsubscribe: (() => void) | null = null;
let pollingInterval: ReturnType<typeof setInterval> | null = null;
let mappingRefreshInterval: ReturnType<typeof setInterval> | null = null;

const sseClients = new Set<SSEClient>();
const statusClients = new Set<StatusClient>();

// Cached state for computing readings from WS pushes
let cachedMappings: EntityMapping[] = [];
let cachedEntityStates = new Map<string, { state: string; lastChanged: number }>();
let previousWatts = new Map<string, number>();
let lastUpdateTimestamp: string | null = null;
let currentHomeId: number | null = null;

// --- Public API ---

/**
 * Register an SSE client to receive live energy data.
 * Starts the bridge if this is the first client.
 * Returns an unsubscribe function.
 */
export function addSSEClient(callback: SSEClient, homeId?: number | null): () => void {
	sseClients.add(callback);
	currentHomeId = homeId ?? null;

	if (!initialized) {
		startBridge();
	}

	return () => {
		sseClients.delete(callback);
		if (sseClients.size === 0 && statusClients.size === 0) {
			stopBridge();
		}
	};
}

/**
 * Register a status listener for the bridge (e.g., for HA Offline badge).
 * Returns an unsubscribe function.
 */
export function addStatusClient(callback: StatusClient): () => void {
	statusClients.add(callback);

	if (!initialized) {
		startBridge();
	}

	// Send current status immediately
	callback(getStatus());

	return () => {
		statusClients.delete(callback);
		if (sseClients.size === 0 && statusClients.size === 0) {
			stopBridge();
		}
	};
}

/**
 * Get current bridge status.
 */
export function getStatus(): BridgeStatus {
	const wsStatus = getWSConnectionStatus();
	let mode: BridgeStatus['mode'];
	if (wsStatus === 'connected') mode = 'websocket';
	else if (pollingInterval) mode = 'polling';
	else mode = 'offline';

	return {
		wsConnected: wsStatus === 'connected',
		wsStatus,
		mode,
		clientCount: sseClients.size,
		lastUpdate: lastUpdateTimestamp
	};
}

/**
 * Force a mapping refresh (e.g., after saving a new mapping).
 */
export async function refreshMappings(): Promise<void> {
	await loadMappingsAndSubscribe();
}

// --- Bridge Lifecycle ---

async function startBridge() {
	if (initialized) return;
	initialized = true;

	await loadMappingsAndSubscribe();

	// Refresh mappings every 5 minutes
	mappingRefreshInterval = setInterval(loadMappingsAndSubscribe, 5 * 60 * 1000);

	// Listen for WS status changes to toggle fallback polling
	wsStatusUnsubscribe = onWSStatusChange(handleWSStatusChange);

	// If WS isn't connected right now, start polling immediately
	if (getWSConnectionStatus() !== 'connected') {
		startPolling();
	}
}

function stopBridge() {
	initialized = false;

	if (wsUnsubscribe) {
		wsUnsubscribe();
		wsUnsubscribe = null;
	}
	if (wsStatusUnsubscribe) {
		wsStatusUnsubscribe();
		wsStatusUnsubscribe = null;
	}
	stopPolling();
	if (mappingRefreshInterval) {
		clearInterval(mappingRefreshInterval);
		mappingRefreshInterval = null;
	}

	cachedEntityStates.clear();
	previousWatts.clear();
	cachedMappings = [];
}

// --- Mapping & Subscription Management ---

async function loadMappingsAndSubscribe() {
	try {
		cachedMappings = await getEntityMappings();

		// Collect all entity IDs we need (power entities + solar entities)
		const entityIds = cachedMappings
			.map(m => m.entityId)
			.filter(Boolean);

		// Add solar entities
		try {
			const solarConfig = await getSolarConfig(currentHomeId);
			if (solarConfig.productionEntity) entityIds.push(solarConfig.productionEntity);
			if (solarConfig.gridImportEntity) entityIds.push(solarConfig.gridImportEntity);
			if (solarConfig.gridExportEntity) entityIds.push(solarConfig.gridExportEntity);
		} catch { /* solar not configured */ }

		if (entityIds.length === 0) return;

		if (wsUnsubscribe) {
			// Update subscription without re-creating the connection
			updateSubscribedEntities(entityIds);
		} else {
			// First subscription — start the WebSocket
			wsUnsubscribe = subscribeToStates(entityIds, handleWSStateChange);
		}
	} catch {
		// Mappings unavailable — will retry on next interval
	}
}

// --- WebSocket Event Handling ---

function handleWSStateChange(entityId: string, newState: string, lastChanged: number) {
	cachedEntityStates.set(entityId, { state: newState, lastChanged });

	// Broadcast a full snapshot to all SSE clients
	broadcastSnapshot();
}

function handleWSStatusChange(status: WSConnectionStatus) {
	if (status === 'connected') {
		// WS recovered — stop polling
		stopPolling();
	} else if (status === 'disconnected' || status === 'auth_error') {
		// WS dropped — start REST polling fallback
		if (!pollingInterval && sseClients.size > 0) {
			startPolling();
		}
	}

	// Notify status listeners
	const bridgeStatus = getStatus();
	for (const client of statusClients) {
		client(bridgeStatus);
	}
}

// --- REST Polling Fallback ---

function startPolling() {
	if (pollingInterval) return;
	pollingInterval = setInterval(pollREST, 5000);
	// Also poll immediately
	pollREST();
}

function stopPolling() {
	if (pollingInterval) {
		clearInterval(pollingInterval);
		pollingInterval = null;
	}
}

async function pollREST() {
	if (sseClients.size === 0) return;

	try {
		const allStates = await haFetch<HAEntityState[]>('/api/states', { homeId: currentHomeId });

		// Update cached states from REST response
		for (const state of allStates) {
			if (cachedMappings.some(m => m.entityId === state.entity_id)) {
				cachedEntityStates.set(state.entity_id, {
					state: state.state,
					lastChanged: new Date(state.last_changed).getTime() / 1000
				});
			}
		}

		broadcastSnapshot();
	} catch {
		// REST also failed — broadcast error status
		const bridgeStatus = getStatus();
		for (const client of statusClients) {
			client(bridgeStatus);
		}
	}
}

// --- Snapshot Broadcasting ---

let broadcastDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const BROADCAST_DEBOUNCE_MS = 200;

function broadcastSnapshot() {
	// Debounce rapid WS events into a single broadcast
	if (broadcastDebounceTimer) return;
	broadcastDebounceTimer = setTimeout(() => {
		broadcastDebounceTimer = null;
		doBroadcast();
	}, BROADCAST_DEBOUNCE_MS);
}

async function doBroadcast() {
	if (sseClients.size === 0) return;

	try {
		// Build circuit readings from cached WS state
		const circuits = buildCircuitReadings();
		const solar = await getSolarReading(currentHomeId);
		const totalWatts = circuits.reduce((sum, c) => sum + c.watts, 0);

		if (solar) {
			solar.netWatts = totalWatts - solar.production;
		}

		const cost = calculateCost(totalWatts);

		// Generate capacity alerts
		const alerts: CapacityAlert[] = circuits
			.filter(c => c.capacityPercent >= 60)
			.map(c => {
				const mapping = cachedMappings.find(m => m.circuitId === c.circuitId);
				return {
					circuitId: c.circuitId,
					circuitName: c.circuitName,
					severity: c.capacityPercent >= 80 ? ('critical' as const) : ('warning' as const),
					currentAmps: c.watts / (mapping?.voltage || 120),
					ratedAmps: mapping?.ampRating || 20,
					percent: c.capacityPercent,
					message: `${c.circuitName} at ${c.capacityPercent}% capacity`
				};
			});

		const timestamp = new Date().toISOString();
		lastUpdateTimestamp = timestamp;

		const data: LiveSSEData = {
			total: totalWatts,
			circuits,
			solar,
			cost,
			alerts,
			timestamp
		};

		// Update previous watts for next trend calculation
		previousWatts = new Map(circuits.map(c => [c.entityId, c.watts]));

		for (const client of sseClients) {
			try {
				client(data);
			} catch { /* client error, ignore */ }
		}
	} catch {
		// Snapshot build failed — clients stay on last known data
	}
}

function buildCircuitReadings(): CircuitReading[] {
	const readings: CircuitReading[] = [];

	for (const mapping of cachedMappings) {
		const cached = cachedEntityStates.get(mapping.entityId);
		if (!cached) continue;

		const watts = parseFloat(cached.state) || 0;
		const capacityWatts = mapping.ampRating * mapping.voltage;
		const capacityPercent = capacityWatts > 0 ? Math.round((watts / capacityWatts) * 100) : 0;

		// Determine trend from previous reading
		let trend: 'up' | 'down' | 'flat' = 'flat';
		const prev = previousWatts.get(mapping.entityId);
		if (prev !== undefined) {
			const diff = watts - prev;
			if (diff > 20) trend = 'up';
			else if (diff < -20) trend = 'down';
		}

		readings.push({
			circuitId: mapping.circuitId,
			circuitName: mapping.circuitName,
			entityId: mapping.entityId,
			watts,
			trend,
			capacityPercent,
			panelName: mapping.panelName
		});
	}

	return readings.sort((a, b) => b.watts - a.watts);
}
