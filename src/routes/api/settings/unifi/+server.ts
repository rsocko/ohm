import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUnifiConfigSafe, saveUnifiConfig } from '$lib/server/unifi-config';

function getHomeId(url: URL): number | null {
	const raw = url.searchParams.get('homeId');
	return raw ? Number(raw) : null;
}

export const GET: RequestHandler = async ({ url }) => {
	const homeId = getHomeId(url);
	const config = await getUnifiConfigSafe(homeId);
	return json(config);
};

export const POST: RequestHandler = async ({ request, url }) => {
	const input = await request.json();
	const homeId = input.homeId ?? getHomeId(url);
	const saved = await saveUnifiConfig(input, homeId);

	const { password, ...safe } = saved;
	return json({ ...safe, hasPassword: Boolean(password) });
};
