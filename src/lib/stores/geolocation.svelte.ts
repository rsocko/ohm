/**
 * Geolocation store for location-aware auto-home switching.
 * Uses the Geolocation API to determine proximity to configured homes.
 * All location data stays on-device — never sent to any server.
 */

const PROXIMITY_THRESHOLD_M = 500; // metres — "near" a home
const STORAGE_KEY = 'geo_permission';

export interface HomeLocation {
	id: number;
	name: string;
	lat: number;
	lng: number;
}

export interface GeoState {
	permission: 'prompt' | 'granted' | 'denied' | 'unavailable';
	nearestHomeId: number | null;
	distanceM: number | null;
	loading: boolean;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 6_371_000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function createGeoStore() {
	let state = $state<GeoState>({
		permission: typeof navigator !== 'undefined' && 'geolocation' in navigator
			? (localStorage.getItem(STORAGE_KEY) as GeoState['permission']) || 'prompt'
			: 'unavailable',
		nearestHomeId: null,
		distanceM: null,
		loading: false
	});

	function findNearest(position: GeolocationPosition, homes: HomeLocation[]): { id: number; dist: number } | null {
		if (!homes.length) return null;
		let best: { id: number; dist: number } | null = null;
		for (const h of homes) {
			const d = haversineM(position.coords.latitude, position.coords.longitude, h.lat, h.lng);
			if (!best || d < best.dist) best = { id: h.id, dist: d };
		}
		return best;
	}

	async function requestPermission(): Promise<'granted' | 'denied'> {
		if (!('geolocation' in navigator)) {
			state.permission = 'unavailable';
			return 'denied';
		}
		state.loading = true;
		try {
			await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
			});
			state.permission = 'granted';
			localStorage.setItem(STORAGE_KEY, 'granted');
			return 'granted';
		} catch {
			state.permission = 'denied';
			localStorage.setItem(STORAGE_KEY, 'denied');
			return 'denied';
		} finally {
			state.loading = false;
		}
	}

	async function detectHome(homes: HomeLocation[]): Promise<number | null> {
		if (state.permission !== 'granted' || !('geolocation' in navigator)) return null;
		state.loading = true;
		try {
			const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
				navigator.geolocation.getCurrentPosition(resolve, reject, {
					enableHighAccuracy: false,
					timeout: 10000,
					maximumAge: 300_000 // cache for 5 min
				});
			});
			const nearest = findNearest(pos, homes);
			if (nearest && nearest.dist <= PROXIMITY_THRESHOLD_M) {
				state.nearestHomeId = nearest.id;
				state.distanceM = Math.round(nearest.dist);
				return nearest.id;
			}
			// Not close enough — pick nearest anyway but mark distance
			if (nearest) {
				state.nearestHomeId = nearest.id;
				state.distanceM = Math.round(nearest.dist);
			}
			return null;
		} catch {
			return null;
		} finally {
			state.loading = false;
		}
	}

	function dismiss() {
		state.permission = 'denied';
		localStorage.setItem(STORAGE_KEY, 'denied');
	}

	function reset() {
		localStorage.removeItem(STORAGE_KEY);
		state.permission = 'prompt';
		state.nearestHomeId = null;
		state.distanceM = null;
	}

	return {
		get state() { return state; },
		requestPermission,
		detectHome,
		dismiss,
		reset,
		PROXIMITY_THRESHOLD_M
	};
}

export const geo = createGeoStore();
