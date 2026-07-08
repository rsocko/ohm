import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { testConnection } from '$lib/server/unifi';

export const POST: RequestHandler = async ({ url }) => {
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;
	const result = await testConnection(homeId);
	return json(result, { status: result.success ? 200 : 502 });
};
