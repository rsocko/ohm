import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const NOCODB_URL = env.NOCODB_URL || 'http://nocodb.socko.us';
const NOCODB_TOKEN = env.NOCODB_API_TOKEN || '';

// Table name → ID mapping
const TABLE_IDS: Record<string, string> = {
	Home: 'm00j4ejurglc7az',
	Area: 'mzd6jg2td2e8v0b',
	Panel: 'mjcnrvv5qipte5v',
	Circuit: 'm6p13bvmehgsm6l',
	Receptacle: 'm5va8tlyhxqg5e6',
	Load: 'meo1ciueftgd8rq'
};

export interface Comment {
	id: string;
	comment: string;
	created_by_email: string;
	created_at: string;
}

/**
 * GET /api/comments?table=Area&row_id=1
 */
export const GET: RequestHandler = async ({ url }) => {
	const table = url.searchParams.get('table');
	const rowId = url.searchParams.get('row_id');

	if (!table || !rowId) {
		return json({ error: 'table and row_id are required' }, { status: 400 });
	}

	const tableId = TABLE_IDS[table];
	if (!tableId) {
		return json({ error: `Unknown table: ${table}` }, { status: 404 });
	}

	try {
		const resp = await fetch(
			`${NOCODB_URL}/api/v2/meta/comments?fk_model_id=${tableId}&row_id=${rowId}`,
			{ headers: { 'xc-token': NOCODB_TOKEN } }
		);
		if (!resp.ok) {
			return json({ error: 'Failed to fetch comments' }, { status: resp.status });
		}
		const data = await resp.json();
		return json({ comments: data.list || [] });
	} catch (e) {
		return json({ error: String(e) }, { status: 500 });
	}
};

/**
 * POST /api/comments
 * Body: { table: string, row_id: number, comment: string }
 */
export const POST: RequestHandler = async ({ request }) => {
	const { table, row_id, comment } = await request.json();

	if (!table || !row_id || !comment?.trim()) {
		return json({ error: 'table, row_id, and comment are required' }, { status: 400 });
	}

	const tableId = TABLE_IDS[table];
	if (!tableId) {
		return json({ error: `Unknown table: ${table}` }, { status: 404 });
	}

	try {
		const resp = await fetch(`${NOCODB_URL}/api/v2/meta/comments`, {
			method: 'POST',
			headers: {
				'xc-token': NOCODB_TOKEN,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				fk_model_id: tableId,
				row_id: String(row_id),
				comment: comment.trim()
			})
		});

		if (!resp.ok) {
			const text = await resp.text();
			return json({ error: 'Failed to add comment', details: text }, { status: resp.status });
		}

		const data = await resp.json();
		return json({ success: true, comment: data });
	} catch (e) {
		return json({ error: String(e) }, { status: 500 });
	}
};
