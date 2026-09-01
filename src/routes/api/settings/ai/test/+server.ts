import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { testLlmConnection } from '$lib/server/ai';
import type { LlmProvider } from '$lib/server/ai-config';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		llmProvider?: LlmProvider;
		ollamaUrl?: string;
		ollamaModel?: string;
		openWebUiUrl?: string;
		openWebUiApiKey?: string;
		openWebUiModel?: string;
		openaiApiKey?: string;
		openaiModel?: string;
		bifrostUrl?: string;
		bifrostModel?: string;
	};

	try {
		const status = await testLlmConnection(body);
		return json(status);
	} catch (error) {
		return json(
			{
				connected: false,
				message: error instanceof Error ? error.message : 'Connection test failed.',
				provider: body.llmProvider || '',
				model: '',
				model_available: null,
				available_models: [],
				chat_completions_available: false,
				nocodb_tool_available: null,
				matched_tools: [],
				tools_endpoint_available: false,
				models_endpoint_available: false
			},
			{ status: 500 }
		);
	}
};
