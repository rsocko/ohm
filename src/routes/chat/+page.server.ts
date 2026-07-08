import type { PageServerLoad } from './$types';

// aiEnabled is already provided by the root layout — no need to re-fetch
export const load: PageServerLoad = async ({ parent }) => {
	const { aiEnabled } = await parent();
	return { aiEnabled };
};
