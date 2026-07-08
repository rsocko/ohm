import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const NOCODB_URL = env.NOCODB_URL || 'http://nocodb.socko.us';
const NOCODB_TOKEN = env.NOCODB_API_TOKEN || '';
const RECEPTACLE_TABLE_ID = 'm5va8tlyhxqg5e6';

/**
 * POST /api/nocodb/receptacle
 * Creates a new Receptacle record and links it to an Area.
 * Body: { fields: Record<string, unknown>, areaId: number }
 */
export const POST: RequestHandler = async ({ request }) => {
	const { fields, areaId } = await request.json();

	if (!fields || !areaId) {
		return json({ error: 'fields and areaId are required' }, { status: 400 });
	}

	try {
		// Step 1: Create the receptacle record
		const createResp = await fetch(`${NOCODB_URL}/api/v2/tables/${RECEPTACLE_TABLE_ID}/records`, {
			method: 'POST',
			headers: {
				'xc-token': NOCODB_TOKEN,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify([fields])
		});

		if (!createResp.ok) {
			const text = await createResp.text();
			return json({ error: 'Failed to create receptacle', details: text }, { status: 500 });
		}

		const created = await createResp.json();
		const newId = Array.isArray(created) ? created[0]?.Id : created.Id;

		if (!newId) {
			return json({ error: 'Record created but no ID returned' }, { status: 500 });
		}

		// Step 2: Link to Area via the links API
		const metaResp = await fetch(`${NOCODB_URL}/api/v2/meta/tables/${RECEPTACLE_TABLE_ID}`, {
			headers: { 'xc-token': NOCODB_TOKEN }
		});
		const meta = await metaResp.json();
		const areaLinkCol = meta.columns?.find(
			(c: { title: string; uidt: string }) => c.title === 'Area' && c.uidt === 'LinkToAnotherRecord'
		);

		if (areaLinkCol) {
			await fetch(
				`${NOCODB_URL}/api/v2/tables/${RECEPTACLE_TABLE_ID}/links/${areaLinkCol.id}/records/${newId}`,
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
