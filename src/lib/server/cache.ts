/**
 * Simple TTL cache for expensive external API calls.
 *
 * Used by the unified sources layer to avoid re-fetching UniFi/HA data
 * on every request. Design doc specifies:
 *   - UniFi: 60s TTL
 *   - HA: 120s TTL
 */

interface CacheEntry<T> {
	data: T;
	expiresAt: number;
}

export class TtlCache<T> {
	private store = new Map<string, CacheEntry<T>>();
	private readonly ttlMs: number;

	constructor(ttlSeconds: number) {
		this.ttlMs = ttlSeconds * 1000;
	}

	get(key: string): T | undefined {
		const entry = this.store.get(key);
		if (!entry) return undefined;
		if (Date.now() > entry.expiresAt) {
			this.store.delete(key);
			return undefined;
		}
		return entry.data;
	}

	set(key: string, data: T): void {
		this.store.set(key, {
			data,
			expiresAt: Date.now() + this.ttlMs
		});
	}

	invalidate(key: string): void {
		this.store.delete(key);
	}

	clear(): void {
		this.store.clear();
	}
}

// --- Shared cache instances for external sources ---

export interface UnifiCacheData {
	clients: unknown[];
	devices: unknown[];
}

export interface HACacheData {
	devices: unknown[];
	areas: unknown[];
}

const UNIFI_TTL = 60; // seconds
const HA_TTL = 120;

export const unifiCache = new TtlCache<UnifiCacheData>(UNIFI_TTL);
export const haCache = new TtlCache<HACacheData>(HA_TTL);
