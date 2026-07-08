/**
 * Energy-specific Home Assistant helpers.
 * Built on ha-transport.ts for REST/WebSocket and ha-client.ts for entity queries.
 * Handles: Emporia Vue discovery, solar readings, circuit readings, cost calculations.
 */

import { env } from '$env/dynamic/private';
import { haFetch, testConnection, subscribeToStates, type HAEntityState } from './ha-transport';
import { getSolarConfig } from './solar-config';
import type { HAEntity, EntityMapping, CircuitReading, SolarReading, TrendDirection } from '$lib/types/energy';

// Energy-specific configuration (env-based; could move to a config file later)
const HA_EMPORIA_PREFIX = env.HA_EMPORIA_PREFIX || 'sensor.emporia_vue_';
const UTILITY_RATE = parseFloat(env.UTILITY_RATE_KWH || '0.138');

// --- Entity Discovery ---

/**
 * Discover all Emporia Vue power entities from HA.
 */
export async function discoverEmporiaEntities(homeId?: number | null): Promise<HAEntity[]> {
	const states = await haFetch<HAEntityState[]>('/api/states', { homeId });
	return states
		.filter(
			(s) =>
				s.entity_id.startsWith(HA_EMPORIA_PREFIX) &&
				s.attributes?.device_class === 'power'
		)
		.map((s) => ({
			entityId: s.entity_id,
			friendlyName: (s.attributes?.friendly_name as string) || s.entity_id,
			state: s.state,
			unitOfMeasurement: (s.attributes?.unit_of_measurement as string) || 'W',
			deviceClass: (s.attributes?.device_class as string) || null,
			lastChanged: s.last_changed
		}));
}

// --- Entity State ---

/**
 * Get current state of a single entity (energy-focused).
 */
export async function getEntityState(entityId: string, homeId?: number | null): Promise<HAEntityState> {
	return await haFetch<HAEntityState>(`/api/states/${entityId}`, { homeId });
}

/**
 * Get all entity states (for discovery).
 */
export async function getAllStates(homeId?: number | null): Promise<HAEntityState[]> {
	return await haFetch<HAEntityState[]>('/api/states', { homeId });
}

// --- History ---

interface HAHistoryEntry {
	state: string;
	last_changed: string;
}

/**
 * Get historical state changes for an entity.
 */
export async function getHistory(
	entityId: string,
	startTime: string,
	endTime?: string,
	homeId?: number | null
): Promise<HAHistoryEntry[][]> {
	const params: Record<string, string> = {
		filter_entity_id: entityId,
		minimal_response: '',
		significant_changes_only: ''
	};
	if (endTime) params.end_time = endTime;
	return await haFetch<HAHistoryEntry[][]>(`/api/history/period/${startTime}`, { params, homeId });
}

// --- Solar ---

/**
 * Get current solar production reading with grid flow and lifetime data.
 * Reads entity IDs from solar-config.json (configured in Settings UI).
 */
export async function getSolarReading(homeId?: number | null): Promise<SolarReading | null> {
	try {
		const config = await getSolarConfig(homeId);
		if (!config.productionEntity) return null;

		const [prodState, todayState, lifetimeState, gridImportState, gridExportState] = await Promise.all([
			getEntityState(config.productionEntity, homeId),
			config.todayEntity ? getEntityState(config.todayEntity, homeId).catch(() => null) : null,
			config.lifetimeEntity ? getEntityState(config.lifetimeEntity, homeId).catch(() => null) : null,
			config.gridImportEntity ? getEntityState(config.gridImportEntity, homeId).catch(() => null) : null,
			config.gridExportEntity ? getEntityState(config.gridExportEntity, homeId).catch(() => null) : null,
		]);

		const production = parseFloat(prodState.state) || 0;
		const todayWh = todayState ? parseFloat(todayState.state) || 0 : 0;
		const lifetimeKwh = lifetimeState ? parseFloat(lifetimeState.state) || 0 : 0;

		// Grid flow: if only gridImport entity is set (e.g. Emporia main panel),
		// treat it as a net sensor — positive = importing, negative = exporting.
		const gridImportRaw = gridImportState ? parseFloat(gridImportState.state) || 0 : 0;
		const gridExportRaw = gridExportState ? parseFloat(gridExportState.state) || 0 : 0;

		let gridImportW: number;
		let gridExportW: number;

		if (gridImportState && !gridExportState) {
			// Single net sensor: split by sign
			gridImportW = Math.max(0, gridImportRaw);
			gridExportW = Math.max(0, -gridImportRaw);
		} else {
			// Separate sensors (or both empty)
			gridImportW = Math.max(0, gridImportRaw);
			gridExportW = Math.max(0, gridExportRaw);
		}

		return {
			production,
			todayWh,
			netWatts: 0, // Calculated by caller with total consumption
			lifetimeKwh,
			gridImportW,
			gridExportW,
		};
	} catch {
		return null;
	}
}

/**
 * Get solar production history for sparkline.
 */
export async function getSolarHistory(hours: number = 24, homeId?: number | null): Promise<{ timestamp: string; watts: number }[]> {
	try {
		const config = await getSolarConfig(homeId);
		if (!config.productionEntity) return [];

		const startTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
		const historyData = await getHistory(config.productionEntity, startTime, undefined, homeId);
		const entries = historyData[0] || [];
		return entries.map((entry) => ({
			timestamp: entry.last_changed,
			watts: parseFloat(entry.state) || 0,
		}));
	} catch {
		return [];
	}
}

// --- Circuit Readings ---

// Cache all HA states briefly to avoid N+1 fetches per SSE tick
// Per-home cache
const _statesCache = new Map<string, { states: HAEntityState[]; expiry: number }>();
const STATES_CACHE_TTL = 1500; // 1.5s — shorter than SSE interval (2s)

async function getAllStatesCached(homeId?: number | null): Promise<HAEntityState[]> {
	const key = homeId ? String(homeId) : 'default';
	const now = Date.now();
	const cached = _statesCache.get(key);
	if (cached && now < cached.expiry) return cached.states;
	const states = await haFetch<HAEntityState[]>('/api/states', { homeId });
	_statesCache.set(key, { states, expiry: now + STATES_CACHE_TTL });
	return states;
}

/**
 * Get live readings for all mapped circuits.
 * Uses a single /api/states call (cached 1.5s) instead of per-entity fetches.
 */
export async function getCircuitReadings(
	mappings: EntityMapping[],
	previousReadings?: Map<string, number>,
	homeId?: number | null
): Promise<CircuitReading[]> {
	const readings: CircuitReading[] = [];
	const entityIds = new Set(mappings.map((mapping) => mapping.entityId).filter(Boolean));

	// Single call to get all states, then filter locally
	const allStates = await getAllStatesCached(homeId);
	const stateMap = new Map(
		allStates
			.filter(s => entityIds.has(s.entity_id))
			.map(s => [s.entity_id, s])
	);

	for (const mapping of mappings) {
		const state = stateMap.get(mapping.entityId);
		if (!state) continue;

		const watts = parseFloat(state.state) || 0;
		const capacityWatts = mapping.ampRating * mapping.voltage;
		const capacityPercent = capacityWatts > 0 ? Math.round((watts / capacityWatts) * 100) : 0;

		// Determine trend from previous reading
		let trend: TrendDirection = 'flat';
		if (previousReadings) {
			const prev = previousReadings.get(mapping.entityId);
			if (prev !== undefined) {
				const diff = watts - prev;
				if (diff > 20) trend = 'up';
				else if (diff < -20) trend = 'down';
			}
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

// --- Connection ---

/**
 * Check HA connectivity (boolean).
 * Caches result for 30 seconds to avoid blocking page loads.
 */
const _connCacheMap = new Map<string, { up: boolean; ts: number }>();
const CONN_CACHE_TTL = 30_000;

export async function checkConnection(homeId?: number | null): Promise<boolean> {
	const key = homeId ? String(homeId) : 'default';
	const cached = _connCacheMap.get(key);
	if (cached && Date.now() - cached.ts < CONN_CACHE_TTL) return cached.up;
	try {
		const info = await testConnection(homeId);
		const up = info !== null;
		_connCacheMap.set(key, { up, ts: Date.now() });
		return up;
	} catch {
		_connCacheMap.set(key, { up: false, ts: Date.now() });
		return false;
	}
}

// --- Cost ---

/**
 * Get utility rate from environment.
 */
export function getUtilityRate(): number {
	return UTILITY_RATE;
}

/**
 * Calculate cost estimate from watts.
 */
export function calculateCost(watts: number, ratePerKwh: number = UTILITY_RATE) {
	const kw = watts / 1000;
	return {
		dailyCost: kw * 24 * ratePerKwh,
		monthlyCost: kw * 24 * 30 * ratePerKwh,
		ratePerKwh
	};
}

// --- WebSocket Re-export ---

export { subscribeToStates } from './ha-transport';
