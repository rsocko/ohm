import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAiConfig, saveAiConfig } from '$lib/server/ai-config';
import type { LlmProvider } from '$lib/server/ai-config';

export const GET: RequestHandler = async () => {
	const config = await getAiConfig();
	return json(config);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		enabled?: boolean;
		llmProvider?: LlmProvider;
		ollamaUrl?: string;
		ollamaModel?: string;
		compatibleUrl?: string;
		compatibleApiKey?: string;
		compatibleModel?: string;
		askApiKey?: string;
		askAuthRequired?: boolean;
		regenerateAskApiKey?: boolean;
	};

	const config = await saveAiConfig({
		enabled: body.enabled,
		llmProvider: body.llmProvider,
		ollamaUrl: body.ollamaUrl,
		ollamaModel: body.ollamaModel,
		compatibleUrl: body.compatibleUrl,
		compatibleApiKey: body.compatibleApiKey,
		compatibleModel: body.compatibleModel,
		askApiKey: body.askApiKey,
		askAuthRequired: body.askAuthRequired,
		regenerateAskApiKey: body.regenerateAskApiKey
	});

	return json(config);
};
