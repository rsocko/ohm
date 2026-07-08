import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTables, getRecords, createRecord, updateRecord, replaceLinks } from '$lib/server/nocodb';
import { getIgnoredDevices } from '$lib/server/discovery-state';

interface LinkBody {
	action: 'link';
	discoveryId: string;
	source: 'unifi' | 'ha';
	externalId: string;
	loadId: number;
}

interface CreateBody {
	action: 'create';
	discoveryId: string;
	source: 'unifi' | 'ha';
	externalId: string;
	name: string;
	deviceType?: string;
	deviceCategory?: string;
	powerSource?: string;
	areaId?: number;
	circuitId?: number;
	upstreamMac?: string;
}

interface IgnoreBody {
	action: 'ignore';
	discoveryId: string;
}

interface IgnoreAllBody {
	action: 'ignore-all';
	discoveryIds: string[];
}

type MatchBody = LinkBody | CreateBody | IgnoreBody | IgnoreAllBody;

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = (await request.json()) as MatchBody;

		if (body.action === 'ignore') {
			getIgnoredDevices().add(body.discoveryId);
			return json({ success: true, action: 'ignored', id: body.discoveryId });
		}

		if (body.action === 'ignore-all') {
			for (const id of body.discoveryIds) {
				getIgnoredDevices().add(id);
			}
			return json({ success: true, action: 'ignored-all', count: body.discoveryIds.length });
		}

		const tables = await listTables();
		const loadTable = tables.find((t) => t.title.toLowerCase() === 'load');
		if (!loadTable) {
			return json({ error: 'Load table not found' }, { status: 500 });
		}

		if (body.action === 'link') {
			// Link discovered device to an existing NocoDB load
			const updates: Record<string, unknown> = {};

			if (body.source === 'unifi') {
				updates['Network_Match_Key'] = body.externalId;
			} else if (body.source === 'ha') {
				updates['HA_Device_Id'] = body.externalId;
			}

			await updateRecord(loadTable.id, body.loadId, updates);
			return json({ success: true, action: 'linked', loadId: body.loadId });
		}

		if (body.action === 'create') {
			// Create a new Load record from discovered device
			const fields: Record<string, unknown> = {
				Name: body.name
			};

			if (body.source === 'unifi') {
				fields['Network_Match_Key'] = body.externalId;
				fields['Device Type'] = body.deviceType || 'Networking';
			} else if (body.source === 'ha') {
				fields['HA_Device_Id'] = body.externalId;
				if (body.deviceType) fields['Device Type'] = body.deviceType;
			}

			if (body.powerSource) fields['Power_Source'] = body.powerSource;

			const created = await createRecord(loadTable.id, fields);

			// Link to area if provided
			if (body.areaId && created.id) {
				await linkToArea(loadTable.id, created.id, body.areaId);
			}

			// Link to circuit if provided
			if (body.circuitId && created.id) {
				await linkToCircuit(loadTable.id, created.id, body.circuitId);
			}

			// Link upstream network device if provided
			if (body.upstreamMac && created.id) {
				const allLoads = await getRecords(loadTable.id, { pageSize: '500' });
				const upstream = allLoads.find(
					(l) => (l.fields['Network_Match_Key'] as string || '').trim().toLowerCase() === body.upstreamMac!.trim().toLowerCase()
				);
				if (upstream) {
					await linkUpstream(loadTable.id, created.id, upstream.id);
				}
			}

			return json({ success: true, action: 'created', loadId: created.id });
		}

		return json({ error: 'Invalid action' }, { status: 400 });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Match action failed' },
			{ status: 500 }
		);
	}
};

async function getNocoDBEnv() {
	const { env } = await import('$env/dynamic/private');
	return {
		url: env.NOCODB_URL || 'http://nocodb.example.com',
		token: env.NOCODB_API_TOKEN || ''
	};
}

async function linkToArea(loadTableId: string, loadId: number, areaId: number) {
	const { url, token } = await getNocoDBEnv();
	try {
		const metaResp = await fetch(`${url}/api/v2/meta/tables/${loadTableId}`, {
			headers: { 'xc-token': token }
		});
		const meta = await metaResp.json();
		const areaCol = meta.columns?.find(
			(c: { title: string; uidt: string }) => c.title === 'Area' && c.uidt === 'LinkToAnotherRecord'
		);
		if (!areaCol) return;

		await fetch(`${url}/api/v2/tables/${loadTableId}/links/${areaCol.id}/records/${loadId}`, {
			method: 'POST',
			headers: { 'xc-token': token, 'Content-Type': 'application/json' },
			body: JSON.stringify([{ Id: areaId }])
		});
	} catch { /* non-fatal */ }
}

async function linkToCircuit(loadTableId: string, loadId: number, circuitId: number) {
	const { url, token } = await getNocoDBEnv();
	try {
		const metaResp = await fetch(`${url}/api/v2/meta/tables/${loadTableId}`, {
			headers: { 'xc-token': token }
		});
		const meta = await metaResp.json();
		const circuitCol = meta.columns?.find(
			(c: { title: string; uidt: string }) => c.title === 'Circuit' && c.uidt === 'LinkToAnotherRecord'
		);
		if (!circuitCol) return;

		await fetch(`${url}/api/v2/tables/${loadTableId}/links/${circuitCol.id}/records/${loadId}`, {
			method: 'POST',
			headers: { 'xc-token': token, 'Content-Type': 'application/json' },
			body: JSON.stringify([{ Id: circuitId }])
		});
	} catch { /* non-fatal */ }
}

async function linkUpstream(loadTableId: string, loadId: number, upstreamLoadId: number) {
	const { url, token } = await getNocoDBEnv();
	try {
		const metaResp = await fetch(`${url}/api/v2/meta/tables/${loadTableId}`, {
			headers: { 'xc-token': token }
		});
		const meta = await metaResp.json();
		const upstreamCol = meta.columns?.find(
			(c: { title: string; uidt: string }) => c.title === 'Network_Upstream' && c.uidt === 'LinkToAnotherRecord'
		);
		if (!upstreamCol) return;

		await fetch(`${url}/api/v2/tables/${loadTableId}/links/${upstreamCol.id}/records/${loadId}`, {
			method: 'POST',
			headers: { 'xc-token': token, 'Content-Type': 'application/json' },
			body: JSON.stringify([{ Id: upstreamLoadId }])
		});
	} catch { /* non-fatal */ }
}
