/**
 * /api/mcp/execute — Execute a confirmed write operation.
 * Replaces the legacy __CONFIRM__ handler in /api/chat.
 *
 * POST body: { confirmation: ConfirmationPayload }
 * Returns: { status: 'ok', message, data } | { status: 'error', error }
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { registry } from '$lib/server/mcp';
import type { ConfirmationPayload } from '$lib/server/mcp';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const confirmation = body.confirmation as ConfirmationPayload | undefined;

	if (!confirmation || !confirmation.tool || !confirmation.execute) {
		return json(
			{ status: 'error', error: 'Missing or invalid confirmation payload' },
			{ status: 400 }
		);
	}

	try {
		const result = await registry.executeConfirmed(confirmation.tool, confirmation.execute.args);
		if (result.success) {
			return json({
				status: 'ok',
				message: `✓ ${confirmation.summary} — done!`,
				data: (result as { data: unknown }).data
			});
		} else {
			return json(
				{ status: 'error', error: (result as { error: string }).error },
				{ status: 422 }
			);
		}
	} catch (err) {
		return json(
			{ status: 'error', error: err instanceof Error ? err.message : 'Execution failed' },
			{ status: 500 }
		);
	}
};
