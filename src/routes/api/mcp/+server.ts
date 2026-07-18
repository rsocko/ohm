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
		mode?: 'read_only' | 'all';
	};
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as MCPRequest;

	switch (body.method) {
		case 'tools/list': {
			const mode = body.params?.mode || 'all';
			let tools = registry.list();
			if (mode === 'read_only') {
				tools = tools.filter(t => t.category === 'read');
			}
			return json({
				tools: tools.map(t => ({
					name: t.name,
					description: t.description,
					category: t.category,
					parameters: t.parameters,
					siriSafe: t.siriSafe ?? (t.category === 'read')
				}))
			});
		}

		case 'tools/call': {
			const name = body.params?.name;
			const args = body.params?.arguments || {};
			const mode = body.params?.mode;

			if (!name) {
				return json({ error: 'Missing params.name' }, { status: 400 });
			}

			const tool = registry.get(name);
			if (!tool) {
				return json({ error: `Unknown tool: ${name}` }, { status: 404 });
			}

			// In read_only mode, reject write/smart tools
			if (mode === 'read_only' && tool.category !== 'read') {
				return json({
					status: 'error',
					error: `Tool "${name}" requires confirmation and is not available in read-only mode. Use mode "all" and handle the confirmation flow.`
				}, { status: 403 });
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
			// Redirect callers to the dedicated /api/mcp/execute endpoint
			const confirmation = body.params?.confirmation;
			if (!confirmation) {
				return json({ error: 'Missing params.confirmation. Use POST /api/mcp/execute instead.' }, { status: 400 });
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
