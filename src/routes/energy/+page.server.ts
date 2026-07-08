import type { PageServerLoad } from './$types';
import { getUtilityRate } from '$lib/server/ha-energy';

// Non-blocking: only return sync data. Connection check moves to client-side.
export const load: PageServerLoad = async () => {
	return {
		utilityRate: getUtilityRate()
	};
};
