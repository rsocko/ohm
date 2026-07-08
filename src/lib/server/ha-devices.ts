/**
 * Home Assistant Device Registry — WebSocket API client.
 * Fetches device list and area registry via HA WebSocket commands.
 * Provides cached access with configurable TTL.
 */

import { getHAConfig } from './ha-config';

// --- Types ---

export interface HADevice {
	id: string;
	name: string | null;
	name_by_user: string | null;
	area_id: string | null;
	config_entries: string[];
	connections: [string, string][];
	identifiers: [string, string][];
	manufacturer: string | null;
	model: string | null;
	sw_version: string | null;
	hw_version: string | null;
	serial_number: string | null;
	via_device_id: string | null;
	disabled_by: string | null;
	entry_type: string | null;
}

export interface HAArea {
	area_id: string;
	name: string;
	picture: string | null;
}

// --- Cache (per-home) ---

interface CacheEntry<T> {
	data: T;
	fetchedAt: number;
}

const CACHE_TTL = 120_000; // 2 minutes
const deviceCaches = new Map<string, CacheEntry<HADevice[]>>();
const areaCaches = new Map<string, CacheEntry<HAArea[]>>();

function cacheKey(homeId?: number | null): string {
	return homeId ? String(homeId) : 'default';
}

// --- WebSocket Command Execution ---

/**
 * Execute a single WebSocket command against HA and return the result.
 * Opens a connection, authenticates, sends the command, and closes.
 */
async function wsCommand<T>(type: string, homeId?: number | null, timeoutMs = 5000): Promise<T> {
	const config = await getHAConfig(homeId);
	if (!config.url || !config.token || !config.enabled) {
		throw new Error('Home Assistant not configured');
	}

	const wsUrl = config.url.replace(/^http/, 'ws') + '/api/websocket';

	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => {
			ws.close();
			reject(new Error(`HA WebSocket timeout for ${type}`));
		}, timeoutMs);

		const ws = new WebSocket(wsUrl);
		const msgId = 1;

		ws.onerror = (err) => {
			clearTimeout(timeout);
			reject(err);
		};

		ws.onmessage = (event) => {
			const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());

			if (msg.type === 'auth_required') {
				ws.send(JSON.stringify({ type: 'auth', access_token: config.token }));
			} else if (msg.type === 'auth_ok') {
				ws.send(JSON.stringify({ id: msgId, type }));
			} else if (msg.type === 'auth_invalid') {
				clearTimeout(timeout);
				ws.close();
				reject(new Error('HA WebSocket auth failed'));
			} else if (msg.type === 'result' && msg.id === msgId) {
				clearTimeout(timeout);
				ws.close();
				if (msg.success) {
					resolve(msg.result as T);
				} else {
					reject(new Error(`HA command ${type} failed: ${JSON.stringify(msg.error)}`));
				}
			}
		};

		ws.onclose = () => {
			clearTimeout(timeout);
		};
	});
}

// --- Public API ---

/**
 * Get all HA devices from the device registry.
 * Uses cached data if fresh (< 2 min old).
 */
export async function getHADevices(forceRefresh = false, homeId?: number | null): Promise<HADevice[]> {
	const key = cacheKey(homeId);
	const cached = deviceCaches.get(key);
	if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
		return cached.data;
	}

	try {
		const devices = await wsCommand<HADevice[]>('config/device_registry/list', homeId);
		deviceCaches.set(key, { data: devices, fetchedAt: Date.now() });
		return devices;
	} catch (err) {
		// Return stale cache if available
		if (cached) return cached.data;
		throw err;
	}
}

/**
 * Get all HA areas from the area registry.
 * Uses cached data if fresh (< 2 min old).
 */
export async function getHAAreas(forceRefresh = false, homeId?: number | null): Promise<HAArea[]> {
	const key = cacheKey(homeId);
	const cached = areaCaches.get(key);
	if (!forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
		return cached.data;
	}

	try {
		const areas = await wsCommand<HAArea[]>('config/area_registry/list', homeId);
		areaCaches.set(key, { data: areas, fetchedAt: Date.now() });
		return areas;
	} catch (err) {
		if (cached) return cached.data;
		throw err;
	}
}

/**
 * Get the age of the HA device cache in seconds. Returns null if no cache exists.
 */
export function getHACacheAge(homeId?: number | null): number | null {
	const cached = deviceCaches.get(cacheKey(homeId));
	if (!cached) return null;
	return Math.round((Date.now() - cached.fetchedAt) / 1000);
}

/**
 * Find the MAC address(es) from a HA device's connections array.
 * Returns lowercase MAC strings.
 */
export function getDeviceMACs(device: HADevice): string[] {
	return device.connections
		.filter(([type]) => type === 'mac')
		.map(([, mac]) => mac.toLowerCase());
}

/**
 * Get the display name for an HA device (user name takes priority).
 */
export function getDeviceDisplayName(device: HADevice): string {
	return device.name_by_user || device.name || 'Unknown Device';
}

/**
 * Clear all cached data (e.g., when settings change).
 */
export function clearHADeviceCache(homeId?: number | null): void {
	const key = cacheKey(homeId);
	deviceCaches.delete(key);
	areaCaches.delete(key);
}
