/**
 * External MCP HTTP endpoint — allows Siri Shortcuts, Home Assistant,
 * and other clients to call Ohm's domain tools directly.
 *
 * POST /api/mcp
 * Body: { method: "tools/list" } | { method: "tools/call", params: { name, arguments } }
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { registry, isConfirmation, isDataResult } from '$lib/server/mcp';
import type { ConfirmationPayload } from '$lib/server/mcp';

interface MCPRequest {
	method: string;
	params?: {
		name?: string;
		arguments?: Record<string, unknown>;
		confirmation?: ConfirmationPayload;
	};
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as MCPRequest;

	switch (body.method) {
		case 'tools/list': {
			const tools = registry.list().map(t => ({
				name: t.name,
				description: t.description,
				category: t.category,
				parameters: t.parameters
			}));
			return json({ tools });
		}

		case 'tools/call': {
			const name = body.params?.name;
			const args = body.params?.arguments || {};

			if (!name) {
				return json({ error: 'Missing params.name' }, { status: 400 });
			}

			const tool = registry.get(name);
			if (!tool) {
				return json({ error: `Unknown tool: ${name}` }, { status: 404 });
			}

			const response = await registry.call(name, args);

			if (isConfirmation(response)) {
				return json({
					status: 'confirmation_required',
					confirmation: response.confirmation
				});
			}
			if (isDataResult(response)) {
				return json({ status: 'ok', data: response.data });
			}
			// Error
			return json({ status: 'error', error: (response as { error: string }).error }, { status: 422 });
		}

		case 'tools/execute': {
			// Execute a previously confirmed write operation
			const confirmation = body.params?.confirmation;
			if (!confirmation) {
				return json({ error: 'Missing params.confirmation' }, { status: 400 });
			}

			const result = await registry.executeConfirmed(confirmation.tool, confirmation.execute.args);
			if (result.success) {
				return json({ status: 'ok', data: (result as { data: unknown }).data });
			}
			return json({ status: 'error', error: (result as { error: string }).error }, { status: 422 });
		}

		default:
			return json({ error: `Unknown method: ${body.method}` }, { status: 400 });
	}
};
