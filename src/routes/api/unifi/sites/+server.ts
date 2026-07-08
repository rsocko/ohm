import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSites } from '$lib/server/unifi';

export const GET: RequestHandler = async ({ url }) => {
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;
	try {
		const sites = await getSites(homeId);
		return json({ sites });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to fetch sites' },
			{ status: 502 }
		);
	}
};
