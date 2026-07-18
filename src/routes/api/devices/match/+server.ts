import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTables, getRecords, createRecord, updateRecord, getLinkColumns, addLinks } from '$lib/server/nocodb';
import { getIgnoredDevices, ignoreDevice, ignoreDevices } from '$lib/server/discovery-state';

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
			await ignoreDevice(body.discoveryId);
			return json({ success: true, action: 'ignored', id: body.discoveryId });
		}

		if (body.action === 'ignore-all') {
			await ignoreDevices(body.discoveryIds);
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

async function findLinkColumnId(tableId: string, columnTitle: string): Promise<string | null> {
	const linkCols = await getLinkColumns(tableId);
	const col = linkCols.find(c => c.title === columnTitle);
	return col?.id || null;
}

async function linkToArea(loadTableId: string, loadId: number, areaId: number) {
	try {
		const colId = await findLinkColumnId(loadTableId, 'Area');
		if (!colId) return;
		await addLinks(loadTableId, colId, loadId, [areaId]);
	} catch { /* non-fatal */ }
}

async function linkToCircuit(loadTableId: string, loadId: number, circuitId: number) {
	try {
		const colId = await findLinkColumnId(loadTableId, 'Circuit');
		if (!colId) return;
		await addLinks(loadTableId, colId, loadId, [circuitId]);
	} catch { /* non-fatal */ }
}

async function linkUpstream(loadTableId: string, loadId: number, upstreamLoadId: number) {
	try {
		const colId = await findLinkColumnId(loadTableId, 'Network_Upstream');
		if (!colId) return;
		await addLinks(loadTableId, colId, loadId, [upstreamLoadId]);
	} catch { /* non-fatal */ }
}
