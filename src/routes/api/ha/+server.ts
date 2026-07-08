import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStatus } from '$lib/server/ha-client';

/**
 * GET /api/ha — Connection test and status
 */
export const GET: RequestHandler = async () => {
	const status = await getStatus();
	if (!status.connected && status.error?.includes('not configured')) {
		return json(status, { status: 503 });
	}
	return json(status, { status: status.connected ? 200 : 503 });
};
