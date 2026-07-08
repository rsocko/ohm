import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAiConfig, saveAiConfig } from '$lib/server/ai-config';

export const GET: RequestHandler = async () => {
	const config = await getAiConfig();
	return json(config);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		enabled?: boolean;
		openWebUiUrl?: string;
		openWebUiApiKey?: string;
		openWebUiModel?: string;
		askApiKey?: string;
		askAuthRequired?: boolean;
		regenerateAskApiKey?: boolean;
	};

	const config = await saveAiConfig({
		enabled: body.enabled,
		openWebUiUrl: body.openWebUiUrl,
		openWebUiApiKey: body.openWebUiApiKey,
		openWebUiModel: body.openWebUiModel,
		askApiKey: body.askApiKey,
		askAuthRequired: body.askAuthRequired,
		regenerateAskApiKey: body.regenerateAskApiKey
	});

	return json(config);
};
