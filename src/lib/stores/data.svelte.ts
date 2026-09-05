/**
 * Shared data store with client-side caching.
 * Fetches from NocoDB once and serves all pages from memory.
 * Falls back to IndexedDB cache when offline.
 * Avoids re-fetching (and skeleton flash) on subsequent navigations.
 */

import { persistData, loadCachedData, persistImageUrls } from './offline';

interface V3Record {
	id: number;
	fields: Record<string, unknown>;
}

type DataTable = 'homes' | 'panels' | 'circuits' | 'receptacles' | 'loads' | 'areas' | 'floorplans';

interface DataState {
	homes: V3Record[];
	panels: V3Record[];
	circuits: V3Record[];
	receptacles: V3Record[];
	loads: V3Record[];
	areas: V3Record[];
	floorplans: V3Record[];
	loaded: boolean;
	loading: boolean;
	error: string | null;
	lastFetchedAt: number | null;
	offline: boolean;
	offlineSince: number | null;
	loadedTables: Record<DataTable, boolean>;
}

const state: DataState = $state({
	homes: [],
	panels: [],
	circuits: [],
	receptacles: [],
	loads: [],
	areas: [],
	floorplans: [],
	loaded: false,
	loading: false,
	error: null,
	lastFetchedAt: null,
	offline: false,
	offlineSince: null,
	loadedTables: {
		homes: false,
		panels: false,
		circuits: false,
		receptacles: false,
		loads: false,
		areas: false,
		floorplans: false
	}
});

let fetchPromise: Promise<void> | null = null;
let networkPromise: Promise<void> | null = null;
let canHydrateFromCache = true;

const primaryTables = ['homes', 'panels', 'circuits', 'receptacles', 'loads', 'areas'] as const;

const tableRequests: Record<DataTable, string> = {
	homes: '/api/nocodb?action=records&table=Home&limit=10',
	panels: '/api/nocodb?action=records&table=Panel&limit=100',
	circuits: '/api/nocodb?action=records&table=Circuit&limit=200',
	receptacles: '/api/nocodb?action=records&table=Receptacle&limit=200',
	loads: '/api/nocodb?action=records&table=Load&limit=200',
	areas: '/api/nocodb?action=records&table=Area&limit=100',
	floorplans: '/api/nocodb?action=records&table=Floorplan&limit=50'
};

/** Extract all image URLs from the dataset for Service Worker caching */
function extractImageUrls(): string[] {
	const urls: string[] = [];
	for (const fp of state.floorplans) {
		const att = fp.fields.Image as Array<{ signedPath?: string }> | undefined;
		if (att?.[0]?.signedPath) {
			urls.push(`/api/image?path=${encodeURIComponent(att[0].signedPath)}`);
		}
	}
	for (const panel of state.panels) {
		const att = panel.fields.Attachment as Array<{ signedPath?: string }> | undefined;
		if (att?.[0]?.signedPath) {
			urls.push(`/api/image?path=${encodeURIComponent(att[0].signedPath)}`);
		}
	}
	return urls;
}

function applyCachedData(cached: { data: Record<string, unknown[]>; lastSyncedAt: number }): void {
	for (const table of [...primaryTables, 'floorplans'] as const) {
		state[table] = (cached.data[table] || []) as V3Record[];
		state.loadedTables[table] = true;
	}
	state.loaded = true;
	state.lastFetchedAt = cached.lastSyncedAt;
}

async function fetchTable(table: DataTable): Promise<void> {
	const response = await fetch(tableRequests[table]);
	if (!response.ok) {
		throw new Error(`Failed to load ${table} (${response.status})`);
	}
	const data = await response.json();
	state[table] = data.records || [];
	state.loadedTables[table] = true;
}

async function fetchAll(): Promise<void> {
	state.loading = true;
	state.error = null;

	try {
		// Floorplans are useful on the rooms page, but should never hold up the
		// homepage. Every table updates the store as soon as its response lands.
		void fetchTable('floorplans').catch((error) => {
			console.warn('[Data] Floorplan load failed:', error);
		});
		const results = await Promise.allSettled(primaryTables.map(fetchTable));
		const failedTables = primaryTables.filter((_, index) => results[index].status === 'rejected');

		if (failedTables.length > 0) {
			const cached = await loadCachedData();
			if (cached) {
				for (const table of failedTables) {
					state[table] = (cached.data[table] || []) as V3Record[];
					state.loadedTables[table] = true;
				}
			}
		}

		state.loaded = primaryTables.every((table) => state.loadedTables[table]);
		if (!state.loaded) {
			throw new Error(`Failed to load ${failedTables.join(', ')}`);
		}

		if (failedTables.length === 0) {
			// Persist to IndexedDB for offline use (non-blocking)
			persistData({
				homes: state.homes,
				panels: state.panels,
				circuits: state.circuits,
				receptacles: state.receptacles,
				loads: state.loads,
				areas: state.areas,
				floorplans: state.floorplans
			}).then(() => {
				// Also cache image URLs for the Service Worker
				const imageUrls = extractImageUrls();
				if (imageUrls.length > 0) persistImageUrls(imageUrls);
			});
			state.lastFetchedAt = Date.now();
			state.offline = false;
			state.offlineSince = null;
		} else {
			state.offline = true;
			state.offlineSince ??= Date.now();
		}
	} catch (e) {
		// Network failed — try IndexedDB fallback
		console.warn('[Data] Network fetch failed, trying offline cache:', e);
		const cached = await loadCachedData();
		if (cached) {
			state.homes = (cached.data.homes || []) as V3Record[];
			state.panels = (cached.data.panels || []) as V3Record[];
			state.circuits = (cached.data.circuits || []) as V3Record[];
			state.receptacles = (cached.data.receptacles || []) as V3Record[];
			state.loads = (cached.data.loads || []) as V3Record[];
			state.areas = (cached.data.areas || []) as V3Record[];
			state.floorplans = (cached.data.floorplans || []) as V3Record[];
			for (const table of [...primaryTables, 'floorplans'] as const) {
				state.loadedTables[table] = true;
			}
			state.loaded = true;
			state.lastFetchedAt = cached.lastSyncedAt;
			state.offline = true;
			state.offlineSince = Date.now();
			state.error = null;
		} else {
			state.error = 'No network connection and no cached data available';
			state.offline = true;
			state.offlineSince = Date.now();
		}
	} finally {
		state.loading = false;
	}
}

function startNetworkLoad(): Promise<void> {
	if (!networkPromise) {
		networkPromise = fetchAll().finally(() => {
			networkPromise = null;
		});
	}
	return networkPromise;
}

async function loadInitialData(): Promise<void> {
	if (canHydrateFromCache) {
		canHydrateFromCache = false;
		const cached = await loadCachedData();
		if (cached) {
			applyCachedData(cached);
			void startNetworkLoad();
			return;
		}
	}
	await startNetworkLoad();
}

/** Ensure data is loaded. Safe to call multiple times — only fetches once. */
export function ensureLoaded(): Promise<void> {
	if (state.loaded) return Promise.resolve();
	if (!fetchPromise) {
		fetchPromise = loadInitialData();
	}
	return fetchPromise;
}

/** Force a fresh re-fetch (e.g. after a write/mutation). */
export function invalidate(): void {
	state.loaded = false;
	fetchPromise = null;
	canHydrateFromCache = false;
}

/** Trigger a re-fetch and wait for it. */
export async function refresh(): Promise<void> {
	await startNetworkLoad();
}

export const dataStore = state;

/** Reactive refreshing flag for UI indicators */
export let refreshing = $state({ value: false });

/** Trigger a re-fetch (use in UI refresh buttons). */
export async function doRefresh(): Promise<void> {
	refreshing.value = true;
	await refresh();
	refreshing.value = false;
}
