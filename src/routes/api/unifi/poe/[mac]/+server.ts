import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPoeBudget } from '$lib/server/unifi';

export const GET: RequestHandler = async ({ params, url }) => {
	const { mac } = params;
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;

	if (!mac) {
		return json({ error: 'MAC address is required' }, { status: 400 });
	}

	try {
		const budget = await getPoeBudget(mac, homeId);

		if (!budget) {
			return json({ error: 'Switch not found or has no POE ports' }, { status: 404 });
		}

		return json(budget);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to fetch POE status' },
			{ status: 502 }
		);
	}
};
