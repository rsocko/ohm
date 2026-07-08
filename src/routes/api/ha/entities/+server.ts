import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEntities, isConfigured } from '$lib/server/ha-client';

/**
 * GET /api/ha/entities — Fetch entity states from Home Assistant
 *
 * Query params:
 *   - domain: filter by entity domain (e.g., "sensor", "switch")
 *   - entity_ids: comma-separated entity IDs
 */
export const GET: RequestHandler = async ({ url }) => {
	const configured = await isConfigured();
	if (!configured) {
		return json({ entities: [], error: 'HA not configured' }, { status: 503 });
	}

	const domain = url.searchParams.get('domain') || undefined;
	const entityIdsParam = url.searchParams.get('entity_ids');
	const entity_ids = entityIdsParam ? entityIdsParam.split(',') : undefined;

	const entities = await getEntities({ domain, entity_ids });

	return json({ entities });
};
