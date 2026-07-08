import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDevices, getClients, mapDeviceTypeToRole, inferPowerSource } from '$lib/server/unifi';
import type { UnifiPort } from '$lib/server/unifi';
import { listTables, getRecords, createRecord, replaceLinks } from '$lib/server/nocodb';

interface DiscoveryItem {
	mac: string;
	name: string;
	type: string;
	role: string;
	ip: string;
	is_wired: boolean;
	power_source: string;
	upstream_mac: string | null;
	/** 'matched' | 'suggested' | 'unmatched' */
	status: 'matched' | 'suggested' | 'unmatched';
	/** NocoDB Load ID if matched or suggested */
	nocodb_id?: number;
	nocodb_title?: string;
	/** Confidence for suggested matches (0-1) */
	confidence?: number;
	match_reason?: string;
	/** Inferred area from device name */
	inferred_area_id?: number;
	inferred_area_name?: string;
}

function normalize(str: string): string {
	return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Infer area from device name by matching area names against the device name prefix */
function inferArea(deviceName: string, areas: Array<{ id: number; name: string }>): { id: number; name: string } | null {
	// Device names typically: "Area Name - Device Model" or "Area Name Device Model"
	const lower = deviceName.toLowerCase();
	let best: { id: number; name: string; len: number } | null = null;
	for (const area of areas) {
		const areaLower = area.name.toLowerCase();
		if (lower.startsWith(areaLower) || lower.includes(areaLower)) {
			// Prefer longest matching area name (e.g. "Basement TV Room" over "Basement")
			if (!best || area.name.length > best.len) {
				best = { id: area.id, name: area.name, len: area.name.length };
			}
		}
	}
	return best ? { id: best.id, name: best.name } : null;
}

function fuzzyScore(a: string, b: string): number {
	const na = normalize(a);
	const nb = normalize(b);
	if (!na || !nb) return 0;
	if (na === nb) return 1.0;
	if (na.includes(nb) || nb.includes(na)) return 0.8;
	// Check word overlap
	const wordsA = a.toLowerCase().split(/[\s\-_]+/).filter(Boolean);
	const wordsB = b.toLowerCase().split(/[\s\-_]+/).filter(Boolean);
	const overlap = wordsA.filter((w) => wordsB.some((wb) => wb.includes(w) || w.includes(wb)));
	if (overlap.length > 0) return 0.4 + (0.4 * overlap.length) / Math.max(wordsA.length, wordsB.length);
	return 0;
}

export const GET: RequestHandler = async ({ url }) => {
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;
	try {
		const [devices, clients] = await Promise.all([getDevices(homeId), getClients(homeId)]);

		// Fetch NocoDB loads and areas
		const tables = await listTables();
		const loadTable = tables.find((t) => t.title.toLowerCase() === 'load');
		const areaTable = tables.find((t) => t.title.toLowerCase() === 'area');
		if (!loadTable) {
			return json({ error: 'Load table not found in NocoDB' }, { status: 500 });
		}

		const loads = await getRecords(loadTable.id, { pageSize: '500' });
		const areas = areaTable ? await getRecords(areaTable.id, { pageSize: '200' }) : [];

		// Build area lookup for name matching
		const areaList = areas.map((a) => ({
			id: a.id,
			name: (a.fields['Name'] as string || '').trim()
		})).filter((a) => a.name);

		// Build lookup maps
		const loadByMac = new Map<string, { id: number; title: string; fields: Record<string, unknown> }>();
		const loadsWithoutMac: Array<{ id: number; title: string; fields: Record<string, unknown> }> = [];

		for (const load of loads) {
			const matchKey = (load.fields['Network_Match_Key'] as string || '').trim().toLowerCase();
			const title = (load.fields['Display Name'] as string || load.fields['Name'] as string || '').trim();
			if (matchKey) {
				loadByMac.set(matchKey, { id: load.id, title: title || `Load #${load.id}`, fields: load.fields });
			} else {
				if (title) {
					loadsWithoutMac.push({ id: load.id, title, fields: load.fields });
				}
			}
		}

		const results: DiscoveryItem[] = [];

		// Process UniFi devices (APs, switches, routers)
		for (const device of devices) {
			const mac = device.mac.toLowerCase();
			const role = mapDeviceTypeToRole(device.type);

			const existing = loadByMac.get(mac);
			if (existing) {
				results.push({
					mac,
					name: device.name,
					type: device.type,
					role,
					ip: device.ip,
					is_wired: true,
					power_source: 'Circuit',
					upstream_mac: device.uplink?.uplink_mac || null,
					status: 'matched',
					nocodb_id: existing.id,
					nocodb_title: existing.title
				});
				continue;
			}

			// Try fuzzy name match against loads without MAC
			let bestMatch: { id: number; title: string; score: number } | null = null;
			for (const candidate of loadsWithoutMac) {
				const score = fuzzyScore(device.name, candidate.title);
				if (score >= 0.4 && (!bestMatch || score > bestMatch.score)) {
					bestMatch = { id: candidate.id, title: candidate.title, score };
				}
			}

			if (bestMatch) {
				results.push({
					mac,
					name: device.name,
					type: device.type,
					role,
					ip: device.ip,
					is_wired: true,
					power_source: 'Circuit',
					upstream_mac: device.uplink?.uplink_mac || null,
					status: 'suggested',
					nocodb_id: bestMatch.id,
					nocodb_title: bestMatch.title,
					confidence: bestMatch.score,
					match_reason: `Name similarity: "${device.name}" ↔ "${bestMatch.title}"`
				});
			} else {
				results.push({
					mac,
					name: device.name,
					type: device.type,
					role,
					ip: device.ip,
					is_wired: true,
					power_source: 'Circuit',
					upstream_mac: device.uplink?.uplink_mac || null,
					status: 'unmatched'
				});
			}
		}

		// Process wired clients (POE candidates, cameras, etc.)
		for (const client of clients) {
			if (!client.is_wired) continue;

			const mac = client.mac.toLowerCase();
			const name = client.name || client.hostname || client.oui || mac;

			// Infer power source
			let powerSource = 'Circuit';
			if (client.sw_mac && client.sw_port) {
				const switchDevice = devices.find((d) => d.mac.toLowerCase() === client.sw_mac?.toLowerCase());
				const port = switchDevice?.port_table?.find((p) => p.port_idx === client.sw_port) as UnifiPort | undefined;
				powerSource = inferPowerSource(port);
			}

			const existing = loadByMac.get(mac);
			if (existing) {
				results.push({
					mac,
					name,
					type: 'client',
					role: 'Client Device',
					ip: client.ip,
					is_wired: true,
					power_source: powerSource,
					upstream_mac: client.sw_mac || null,
					status: 'matched',
					nocodb_id: existing.id,
					nocodb_title: existing.title
				});
				continue;
			}

			// Fuzzy name match
			let bestMatch: { id: number; title: string; score: number } | null = null;
			for (const candidate of loadsWithoutMac) {
				const score = fuzzyScore(name, candidate.title);
				if (score >= 0.4 && (!bestMatch || score > bestMatch.score)) {
					bestMatch = { id: candidate.id, title: candidate.title, score };
				}
			}

			if (bestMatch) {
				results.push({
					mac,
					name,
					type: 'client',
					role: 'Client Device',
					ip: client.ip,
					is_wired: true,
					power_source: powerSource,
					upstream_mac: client.sw_mac || null,
					status: 'suggested',
					nocodb_id: bestMatch.id,
					nocodb_title: bestMatch.title,
					confidence: bestMatch.score,
					match_reason: `Name similarity: "${name}" ↔ "${bestMatch.title}"`
				});
			} else {
				results.push({
					mac,
					name,
					type: 'client',
					role: 'Client Device',
					ip: client.ip,
					is_wired: true,
					power_source: powerSource,
					upstream_mac: client.sw_mac || null,
					status: 'unmatched'
				});
			}
		}

		// Infer area for each non-matched result
		for (const item of results) {
			if (item.status !== 'matched') {
				const area = inferArea(item.name, areaList);
				if (area) {
					item.inferred_area_id = area.id;
					item.inferred_area_name = area.name;
				}
			}
		}

		// Collect loads that aren't matched to any discovered device (candidates for manual linking)
		const matchedLoadIds = new Set(
			results.filter((r) => r.status === 'matched' || r.status === 'suggested').map((r) => r.nocodb_id)
		);
		const availableLoads = loads
			.map((l) => ({
				id: l.id,
				title: (l.fields['Display Name'] as string) || (l.fields['Name'] as string) || `Load #${l.id}`
			}))
			.filter((l) => !matchedLoadIds.has(l.id) && !l.title.startsWith('Load #'))
			.sort((a, b) => a.title.localeCompare(b.title));

		return json({
			items: results,
			availableLoads,
			areas: areaList,
			summary: {
				matched: results.filter((r) => r.status === 'matched').length,
				suggested: results.filter((r) => r.status === 'suggested').length,
				unmatched: results.filter((r) => r.status === 'unmatched').length
			}
		});
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Discovery failed' },
			{ status: 502 }
		);
	}
};

/** Accept a suggested match (write MAC to existing record) or create a new Load. */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { action, mac, name, role, power_source, nocodb_id, area_id, upstream_mac } = body as {
			action: 'accept' | 'create';
			mac: string;
			name: string;
			role?: string;
			power_source?: string;
			nocodb_id?: number;
			area_id?: number;
			upstream_mac?: string;
		};

		const tables = await listTables();
		const loadTable = tables.find((t) => t.title.toLowerCase() === 'load');
		if (!loadTable) {
			return json({ error: 'Load table not found' }, { status: 500 });
		}

		// Resolve upstream MAC to a NocoDB load ID
		let upstreamLoadId: number | null = null;
		if (upstream_mac) {
			const allLoads = await getRecords(loadTable.id, { limit: '200' });
			const upstreamLoad = allLoads.find(
				(l) => (l.fields['Network_Match_Key'] as string || '').trim().toLowerCase() === upstream_mac.trim().toLowerCase()
			);
			if (upstreamLoad) upstreamLoadId = upstreamLoad.id;
		}

		if (action === 'accept' && nocodb_id) {
			// Accept suggested match: write MAC to existing record
			const { updateRecord } = await import('$lib/server/nocodb');
			const updates: Record<string, unknown> = { Network_Match_Key: mac, 'Device Type': 'Networking' };
			if (role) updates['Network_Role'] = role;
			if (power_source) updates['Power_Source'] = power_source;
			await updateRecord(loadTable.id, nocodb_id, updates);

			// Link to area if provided and not already linked
			if (area_id) {
				await linkLoadToArea(loadTable.id, nocodb_id, area_id);
			}

			// Link upstream
			if (upstreamLoadId) {
				await linkLoadUpstream(loadTable.id, nocodb_id, upstreamLoadId);
			}

			return json({ success: true, action: 'accepted', nocodb_id });
		}

		if (action === 'create') {
			// Create a new Load record
			const fields: Record<string, unknown> = {
				Name: name,
				Network_Match_Key: mac,
				'Device Type': 'Networking'
			};
			if (role) fields['Network_Role'] = role;
			if (power_source) fields['Power_Source'] = power_source;

			const created = await createRecord(loadTable.id, fields);

			// Link to area if provided
			if (area_id && created.id) {
				await linkLoadToArea(loadTable.id, created.id, area_id);
			}

			// Link upstream
			if (upstreamLoadId && created.id) {
				await linkLoadUpstream(loadTable.id, created.id, upstreamLoadId);
			}

			return json({ success: true, action: 'created', nocodb_id: created.id });
		}

		return json({ error: 'Invalid action. Use "accept" or "create".' }, { status: 400 });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Action failed' },
			{ status: 500 }
		);
	}
};

/** Link a load record to an area via NocoDB links API */
async function linkLoadToArea(loadTableId: string, loadId: number, areaId: number) {
	const NOCODB_URL = (await import('$env/dynamic/private')).env.NOCODB_URL || 'http://nocodb.socko.us';
	const NOCODB_TOKEN = (await import('$env/dynamic/private')).env.NOCODB_API_TOKEN || '';
	try {
		const metaResp = await fetch(`${NOCODB_URL}/api/v2/meta/tables/${loadTableId}`, {
			headers: { 'xc-token': NOCODB_TOKEN }
		});
		const meta = await metaResp.json();
		const areaLinkCol = meta.columns?.find(
			(c: { title: string; uidt: string }) => c.title === 'Area' && c.uidt === 'LinkToAnotherRecord'
		);
		if (!areaLinkCol) return;

		await fetch(
			`${NOCODB_URL}/api/v2/tables/${loadTableId}/links/${areaLinkCol.id}/records/${loadId}`,
			{
				method: 'POST',
				headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
				body: JSON.stringify([{ Id: areaId }])
			}
		);
	} catch {
		// Non-fatal — load was created, area linking failed silently
	}
}

/** Link a load record to its upstream network device via NocoDB links API */
async function linkLoadUpstream(loadTableId: string, loadId: number, upstreamLoadId: number) {
	const NOCODB_URL = (await import('$env/dynamic/private')).env.NOCODB_URL || 'http://nocodb.socko.us';
	const NOCODB_TOKEN = (await import('$env/dynamic/private')).env.NOCODB_API_TOKEN || '';
	try {
		const metaResp = await fetch(`${NOCODB_URL}/api/v2/meta/tables/${loadTableId}`, {
			headers: { 'xc-token': NOCODB_TOKEN }
		});
		const meta = await metaResp.json();
		const upstreamCol = meta.columns?.find(
			(c: { title: string; uidt: string }) => c.title === 'Network_Upstream' && c.uidt === 'LinkToAnotherRecord'
		);
		if (!upstreamCol) return;

		await fetch(
			`${NOCODB_URL}/api/v2/tables/${loadTableId}/links/${upstreamCol.id}/records/${loadId}`,
			{
				method: 'POST',
				headers: { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' },
				body: JSON.stringify([{ Id: upstreamLoadId }])
			}
		);
	} catch {
		// Non-fatal — upstream linking failed silently
	}
}
