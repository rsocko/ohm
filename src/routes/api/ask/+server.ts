import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { askElectrical } from '$lib/server/ai';
import { getAiConfig } from '$lib/server/ai-config';
import { timingSafeEqual } from 'node:crypto';

function getRequestApiKey(request: Request): string {
	const authorization = request.headers.get('authorization');
	if (authorization?.toLowerCase().startsWith('bearer ')) {
		return authorization.slice(7).trim();
	}

	return request.headers.get('x-api-key')?.trim() || '';
}

function safeEqual(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);

	if (leftBuffer.length !== rightBuffer.length) {
		return false;
	}

	return timingSafeEqual(leftBuffer, rightBuffer);
}

export const POST: RequestHandler = async ({ request }) => {
	const config = await getAiConfig();

	// Auth check — skip if auth is disabled in settings
	if (config.askAuthRequired) {
		const requestApiKey = getRequestApiKey(request);
		if (!config.askApiKey || !requestApiKey || !safeEqual(config.askApiKey, requestApiKey)) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}
	}

	const { question } = await request.json();

	if (!question || typeof question !== 'string') {
		return json({ error: 'Missing "question" field' }, { status: 400 });
	}

	try {
		const startedAt = Date.now();
		const result = await askElectrical(question);

		return json({
			answer: result.answer,
			sources: result.sources,
			model: result.model,
			duration_ms: Date.now() - startedAt
		});
	} catch (err) {
		console.error('AI error:', err);
		return json({ error: 'Failed to process question' }, { status: 500 });
	}
};
