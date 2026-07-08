import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callService, isConfigured } from '$lib/server/ha-client';

/**
 * POST /api/ha/control — Control a device via Home Assistant service call
 *
 * Body: { entity_id, action, data? }
 */
export const POST: RequestHandler = async ({ request }) => {
	const configured = await isConfigured();
	if (!configured) {
		return json({ success: false, error: 'HA not configured' }, { status: 503 });
	}

	const body = await request.json();

	// Validate required fields
	if (!body.entity_id || !body.action) {
		return json(
			{ success: false, error: 'Missing required fields: entity_id, action' },
			{ status: 400 }
		);
	}

	// Validate action
	const validActions = ['turn_on', 'turn_off', 'toggle'];
	if (!validActions.includes(body.action)) {
		return json(
			{ success: false, error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
			{ status: 400 }
		);
	}

	const result = await callService({
		entity_id: body.entity_id,
		action: body.action,
		data: body.data
	});

	return json(result, { status: result.success ? 200 : 502 });
};
