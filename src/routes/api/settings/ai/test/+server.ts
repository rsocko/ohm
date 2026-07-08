import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { testOpenWebUiConnection } from '$lib/server/ai';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		openWebUiUrl?: string;
		openWebUiApiKey?: string;
		openWebUiModel?: string;
	};

	try {
		const status = await testOpenWebUiConnection(body);
		return json(status);
	} catch (error) {
		return json(
			{
				connected: false,
				message: error instanceof Error ? error.message : 'Connection test failed.',
				model: body.openWebUiModel || '',
				model_available: null,
				available_models: [],
				nocodb_tool_available: null,
				matched_tools: [],
				tools_endpoint_available: false,
				models_endpoint_available: false,
				chat_completions_available: false
			},
			{ status: 500 }
		);
	}
};
