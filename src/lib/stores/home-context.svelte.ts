/**
 * Global home context — persists selected home across all pages.
 * Stored in localStorage so it survives reloads.
 * All pages import this to scope their data to the active home.
 */

import { dataStore } from './data.svelte';

interface V3Record {
	id: number;
	fields: Record<string, unknown>;
}

// --- State ---

const STORAGE_KEY = 'electrical-config:selectedHomeId';
const LOCKED_STORAGE_KEY = 'electrical-config:lockedHomes';

function loadPersistedHomeId(): number | null {
	if (typeof window === 'undefined') return null;
	const raw = localStorage.getItem(STORAGE_KEY);
	return raw ? Number(raw) : null;
}

function loadLockedHomes(): Set<number> {
	if (typeof window === 'undefined') return new Set();
	try {
		const raw = localStorage.getItem(LOCKED_STORAGE_KEY);
		return raw ? new Set(JSON.parse(raw) as number[]) : new Set();
	} catch {
		return new Set();
	}
}

function persistLockedHomes(locked: Set<number>): void {
	if (typeof window === 'undefined') return;
	localStorage.setItem(LOCKED_STORAGE_KEY, JSON.stringify([...locked]));
}

let _selectedHomeId: number | null = $state(loadPersistedHomeId());
let _lockedHomes: Set<number> = $state(loadLockedHomes());

export const homeContext = {
	get selectedHomeId() { return _selectedHomeId; },
	set selectedHomeId(id: number | null) {
		_selectedHomeId = id;
		if (typeof window !== 'undefined') {
			if (id != null) localStorage.setItem(STORAGE_KEY, String(id));
			else localStorage.removeItem(STORAGE_KEY);
		}
	},
	get selectedHomeName(): string {
		if (!_selectedHomeId) return '';
		const home = dataStore.homes.find(h => h.id === _selectedHomeId);
		return (home?.fields?.Name as string) || '';
	},
	get homes() { return dataStore.homes; },
	get hasMultipleHomes() { return dataStore.homes.length > 1; },
	/** Whether the currently selected home is locked (read-only). */
	get isLocked(): boolean {
		if (!_selectedHomeId) return false;
		return _lockedHomes.has(_selectedHomeId);
	},
	/** Toggle lock state for the currently selected home. */
	toggleLocked(): void {
		if (!_selectedHomeId) return;
		if (_lockedHomes.has(_selectedHomeId)) {
			_lockedHomes.delete(_selectedHomeId);
		} else {
			_lockedHomes.add(_selectedHomeId);
		}
		_lockedHomes = new Set(_lockedHomes); // trigger reactivity
		persistLockedHomes(_lockedHomes);
	},
	/** Set lock state for a specific home. */
	setLocked(homeId: number, locked: boolean): void {
		if (locked) {
			_lockedHomes.add(homeId);
		} else {
			_lockedHomes.delete(homeId);
		}
		_lockedHomes = new Set(_lockedHomes);
		persistLockedHomes(_lockedHomes);
	},
	/** Check if a specific home is locked. */
	isHomeLocked(homeId: number): boolean {
		return _lockedHomes.has(homeId);
	}
};

/**
 * Initialize home context after data is loaded.
 * Call this once from layout or the first page that loads.
 * Auto-selects first home if nothing persisted.
 */
export function initHomeContext(): void {
	if (_selectedHomeId) {
		// Validate persisted ID still exists
		const exists = dataStore.homes.some(h => h.id === _selectedHomeId);
		if (!exists && dataStore.homes.length > 0) {
			homeContext.selectedHomeId = dataStore.homes[0].id;
		}
	} else if (dataStore.homes.length > 0) {
		homeContext.selectedHomeId = dataStore.homes[0].id;
	}
}

// --- Derived Filtering Helpers ---
// Svelte 5 modules cannot export $derived directly, so we use
// private $derived + exported getter functions.

const _homeAreaIds = $derived.by(() => {
	if (!_selectedHomeId) return new Set<number>();
	return new Set(
		dataStore.areas
			.filter(a => (a.fields.Home as { id: number } | undefined)?.id === _selectedHomeId)
			.map(a => a.id)
	);
});

const _homePanelIds = $derived.by(() => {
	return new Set(
		dataStore.panels
			.filter(p => _homeAreaIds.has((p.fields.Area as { id: number } | undefined)?.id ?? -1))
			.map(p => p.id)
	);
});

interface HomeFilteredData {
	areas: V3Record[];
	panels: V3Record[];
	circuits: V3Record[];
	loads: V3Record[];
	receptacles: V3Record[];
	floorplans: V3Record[];
}

const _homeFiltered = $derived.by((): HomeFilteredData => {
	if (!_selectedHomeId) {
		return { areas: [], panels: [], circuits: [], loads: [], receptacles: [], floorplans: [] };
	}

	const areaIds = _homeAreaIds;
	const areas = dataStore.areas.filter(a => areaIds.has(a.id));
	const panels = dataStore.panels.filter(p => areaIds.has((p.fields.Area as { id: number } | undefined)?.id ?? -1));
	const panelIds = new Set(panels.map(p => p.id));
	const circuits = dataStore.circuits.filter(c => panelIds.has((c.fields.Panel as { id: number } | undefined)?.id ?? -1));
	const loads = dataStore.loads.filter(l => areaIds.has((l.fields.Area as { id: number } | undefined)?.id ?? -1));
	const receptacles = dataStore.receptacles.filter(r => areaIds.has((r.fields.Area as { id: number } | undefined)?.id ?? -1));
	const floorplans = dataStore.floorplans.filter(f => (f.fields.Home as { id: number } | undefined)?.id === _selectedHomeId);

	return { areas, panels, circuits, loads, receptacles, floorplans };
});

/** Area IDs belonging to the selected home */
export function getHomeAreaIds(): Set<number> { return _homeAreaIds; }

/** Panel IDs belonging to the selected home */
export function getHomePanelIds(): Set<number> { return _homePanelIds; }

/** All data filtered to the selected home — reactive when used inside $derived or templates */
export const homeFiltered = {
	get areas() { return _homeFiltered.areas; },
	get panels() { return _homeFiltered.panels; },
	get circuits() { return _homeFiltered.circuits; },
	get loads() { return _homeFiltered.loads; },
	get receptacles() { return _homeFiltered.receptacles; },
	get floorplans() { return _homeFiltered.floorplans; }
};
