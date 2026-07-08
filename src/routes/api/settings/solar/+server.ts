import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSolarConfig, saveSolarConfig } from '$lib/server/solar-config';

function getHomeId(url: URL): number | null {
	const raw = url.searchParams.get('homeId');
	return raw ? Number(raw) : null;
}

export const GET: RequestHandler = async ({ url }) => {
	const homeId = getHomeId(url);
	const config = await getSolarConfig(homeId);
	return json(config);
};

export const POST: RequestHandler = async ({ request, url }) => {
	const body = await request.json();
	const homeId = body.homeId ?? getHomeId(url);
	const config = await saveSolarConfig(body, homeId);
	return json(config);
};
