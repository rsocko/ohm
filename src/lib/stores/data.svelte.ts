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
	offlineSince: null
});

let fetchPromise: Promise<void> | null = null;

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

async function fetchAll(): Promise<void> {
	if (state.loaded || state.loading) return;
	state.loading = true;
	state.error = null;

	try {
		const [homeResp, panelResp, circuitResp, receptacleResp, loadResp, areaResp] =
			await Promise.all([
				fetch('/api/nocodb?action=records&table=Home&limit=10'),
				fetch('/api/nocodb?action=records&table=Panel&limit=100'),
				fetch('/api/nocodb?action=records&table=Circuit&limit=200'),
				fetch('/api/nocodb?action=records&table=Receptacle&limit=200'),
				fetch('/api/nocodb?action=records&table=Load&limit=200'),
				fetch('/api/nocodb?action=records&table=Area&limit=100')
			]);
		const [homeData, panelData, circuitData, receptacleData, loadData, areaData] =
			await Promise.all([
				homeResp.json(),
				panelResp.json(),
				circuitResp.json(),
				receptacleResp.json(),
				loadResp.json(),
				areaResp.json()
			]);

		state.homes = homeData.records || [];
		state.panels = panelData.records || [];
		state.circuits = circuitData.records || [];
		state.receptacles = receptacleData.records || [];
		state.loads = loadData.records || [];
		state.areas = areaData.records || [];

		// Floorplan table (may not exist yet — fetch gracefully)
		try {
			const fpResp = await fetch('/api/nocodb?action=records&table=Floorplan&limit=50');
			if (fpResp.ok) {
				const fpData = await fpResp.json();
				state.floorplans = fpData.records || [];
			}
		} catch { /* table doesn't exist yet, that's fine */ }

		state.loaded = true;
		state.lastFetchedAt = Date.now();
		state.offline = false;
		state.offlineSince = null;

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

/** Ensure data is loaded. Safe to call multiple times — only fetches once. */
export function ensureLoaded(): Promise<void> {
	if (state.loaded) return Promise.resolve();
	if (!fetchPromise) {
		fetchPromise = fetchAll();
	}
	return fetchPromise;
}

/** Force a fresh re-fetch (e.g. after a write/mutation). */
export function invalidate(): void {
	state.loaded = false;
	fetchPromise = null;
}

/** Trigger a re-fetch and wait for it. */
export async function refresh(): Promise<void> {
	invalidate();
	await ensureLoaded();
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
