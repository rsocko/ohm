import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const NOCODB_URL = env.NOCODB_URL || 'http://nocodb.example.com';
const NOCODB_TOKEN = env.NOCODB_API_TOKEN || '';
const BASE_ID = env.NOCODB_BASE_ID || 'pt7ylnikbprtaqy';
const LOAD_TABLE_ID = 'meo1ciueftgd8rq';

/**
 * POST /api/nocodb/load
 * Creates a new Load record and links it to an Area.
 * Body: { fields: Record<string, unknown>, areaId: number }
 */
export const POST: RequestHandler = async ({ request }) => {
	const { fields, areaId } = await request.json();

	if (!fields || !areaId) {
		return json({ error: 'fields and areaId are required' }, { status: 400 });
	}

	try {
		// Step 1: Create the load record
		const createResp = await fetch(`${NOCODB_URL}/api/v2/tables/${LOAD_TABLE_ID}/records`, {
			method: 'POST',
			headers: {
				'xc-token': NOCODB_TOKEN,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify([fields])
		});

		if (!createResp.ok) {
			const text = await createResp.text();
			return json({ error: 'Failed to create load', details: text }, { status: 500 });
		}

		const created = await createResp.json();
		const newId = Array.isArray(created) ? created[0]?.Id : created.Id;

		if (!newId) {
			return json({ error: 'Record created but no ID returned' }, { status: 500 });
		}

		// Step 2: Link to Area via the v3 links API
		// First get the Area link column ID
		const metaResp = await fetch(`${NOCODB_URL}/api/v2/meta/tables/${LOAD_TABLE_ID}`, {
			headers: { 'xc-token': NOCODB_TOKEN }
		});
		const meta = await metaResp.json();
		const areaLinkCol = meta.columns?.find(
			(c: { title: string; uidt: string }) => c.title === 'Area' && c.uidt === 'LinkToAnotherRecord'
		);

		if (areaLinkCol) {
			// Link using v2 nested link API
			await fetch(
				`${NOCODB_URL}/api/v2/tables/${LOAD_TABLE_ID}/links/${areaLinkCol.id}/records/${newId}`,
				{
					method: 'POST',
					headers: {
						'xc-token': NOCODB_TOKEN,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify([{ Id: areaId }])
				}
			);
		}

		return json({ success: true, id: newId });
	} catch (e) {
		return json({ error: String(e) }, { status: 500 });
	}
};

/**
 * PATCH /api/nocodb/load
 * Update a load's status, area, or other fields.
 * Body: { id: number, fields: Record<string, unknown>, areaId?: number }
 */
export const PATCH: RequestHandler = async ({ request }) => {
	const { id, fields, areaId } = await request.json();

	if (!id) {
		return json({ error: 'id is required' }, { status: 400 });
	}

	try {
		// Update fields
		if (fields && Object.keys(fields).length > 0) {
			const patchResp = await fetch(`${NOCODB_URL}/api/v2/tables/${LOAD_TABLE_ID}/records`, {
				method: 'PATCH',
				headers: {
					'xc-token': NOCODB_TOKEN,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify([{ Id: id, ...fields }])
			});
			if (!patchResp.ok) {
				const text = await patchResp.text();
				return json({ error: 'Failed to update load', details: text }, { status: 500 });
			}
		}

		// Re-link to new area if provided
		if (areaId) {
			const metaResp = await fetch(`${NOCODB_URL}/api/v2/meta/tables/${LOAD_TABLE_ID}`, {
				headers: { 'xc-token': NOCODB_TOKEN }
			});
			const meta = await metaResp.json();
			const areaLinkCol = meta.columns?.find(
				(c: { title: string; uidt: string }) => c.title === 'Area' && c.uidt === 'LinkToAnotherRecord'
			);

			if (areaLinkCol) {
				// Unlink existing, then link new
				// Get current links
				const linksResp = await fetch(
					`${NOCODB_URL}/api/v2/tables/${LOAD_TABLE_ID}/links/${areaLinkCol.id}/records/${id}`,
					{ headers: { 'xc-token': NOCODB_TOKEN } }
				);
				if (linksResp.ok) {
					const linksData = await linksResp.json();
					const existing = linksData.list || [];
					if (existing.length > 0) {
						await fetch(
							`${NOCODB_URL}/api/v2/tables/${LOAD_TABLE_ID}/links/${areaLinkCol.id}/records/${id}`,
							{
								method: 'DELETE',
								headers: {
									'xc-token': NOCODB_TOKEN,
									'Content-Type': 'application/json'
								},
								body: JSON.stringify(existing.map((e: { Id: number }) => ({ Id: e.Id })))
							}
						);
					}
				}
				// Link new area
				await fetch(
					`${NOCODB_URL}/api/v2/tables/${LOAD_TABLE_ID}/links/${areaLinkCol.id}/records/${id}`,
					{
						method: 'POST',
						headers: {
							'xc-token': NOCODB_TOKEN,
							'Content-Type': 'application/json'
						},
						body: JSON.stringify([{ Id: areaId }])
					}
				);
			}
		}

		return json({ success: true, id });
	} catch (e) {
		return json({ error: String(e) }, { status: 500 });
	}
};
