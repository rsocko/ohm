/**
 * Semantic search API endpoint.
 * GET /api/search/semantic?q=<query>&type=<filter>&limit=<n>
 * POST /api/search/semantic { action: 'reindex' } — trigger re-indexing
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { semanticSearch, reindex, getIndexStatus } from '$lib/server/vector-store';

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q');
	const typeFilter = url.searchParams.get('type') || undefined;
	const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 50);

	if (!query?.trim()) {
		return json({ error: 'Missing "q" parameter' }, { status: 400 });
	}

	try {
		const results = await semanticSearch(query.trim(), { limit, typeFilter });
		const status = getIndexStatus();

		return json({
			query: query.trim(),
			results: results.map(r => ({
				id: r.document.id,
				type: r.document.type,
				label: r.document.label,
				refId: r.document.refId,
				meta: r.document.meta,
				score: Math.round(r.score * 1000) / 1000,
				textScore: Math.round(r.textScore * 1000) / 1000,
				semanticScore: Math.round(r.semanticScore * 1000) / 1000
			})),
			totalResults: results.length,
			indexStatus: {
				documentCount: status.documentCount,
				indexedAt: status.indexedAt ? new Date(status.indexedAt).toISOString() : null
			}
		});
	} catch (err) {
		console.error('[Semantic Search] Error:', err);
		return json(
			{ error: err instanceof Error ? err.message : 'Semantic search failed' },
			{ status: 500 }
		);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();

	if (body.action === 'reindex') {
		try {
			const result = await reindex();
			return json({
				success: true,
				documentCount: result.documentCount,
				durationMs: result.durationMs
			});
		} catch (err) {
			return json(
				{ error: err instanceof Error ? err.message : 'Reindex failed' },
				{ status: 500 }
			);
		}
	}

	if (body.action === 'status') {
		return json(getIndexStatus());
	}

	return json({ error: 'Unknown action. Use: reindex, status' }, { status: 400 });
};
