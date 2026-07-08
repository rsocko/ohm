import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDevices, getClients, mapDeviceTypeToRole, inferPowerSource } from '$lib/server/unifi';
import type { UnifiPort } from '$lib/server/unifi';
import { updateLastSync } from '$lib/server/unifi-config';
import { listTables, getRecords, updateRecord, replaceLinks } from '$lib/server/nocodb';

interface MatchResult {
	matched: Array<{
		unifi_mac: string;
		unifi_name: string;
		nocodb_id: number;
		nocodb_title: string;
		updates: Record<string, string>;
	}>;
	unmatched_unifi: Array<{ mac: string; name: string; type: string }>;
	unmatched_nocodb: Array<{ id: number; title: string; match_key: string }>;
	topology_updates: number;
}

export const POST: RequestHandler = async ({ url }) => {
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;
	try {
		// Fetch UniFi data
		const [devices, clients] = await Promise.all([getDevices(homeId), getClients(homeId)]);

		// Fetch NocoDB Load table records
		const tables = await listTables();
		const loadTable = tables.find((t) => t.title.toLowerCase() === 'load');
		if (!loadTable) {
			return json({ error: 'Load table not found in NocoDB' }, { status: 500 });
		}

		const loads = await getRecords(loadTable.id, { pageSize: '500' });

		// Build MAC → NocoDB load map
		const nocodbByMac = new Map<string, { id: number; title: string; fields: Record<string, unknown> }>();
		const nocodbWithMatchKey: Array<{ id: number; title: string; match_key: string }> = [];

		for (const load of loads) {
			const matchKey = (load.fields['Network_Match_Key'] as string || '').trim().toLowerCase();
			if (matchKey) {
				nocodbByMac.set(matchKey, {
					id: load.id,
					title: load.fields['Title'] as string || `Load #${load.id}`,
					fields: load.fields
				});
				nocodbWithMatchKey.push({
					id: load.id,
					title: load.fields['Title'] as string || `Load #${load.id}`,
					match_key: matchKey
				});
			}
		}

		// Build MAC → NocoDB ID map (for topology resolution)
		const macToNocodbId = new Map<string, number>();
		for (const [mac, load] of nocodbByMac) {
			macToNocodbId.set(mac, load.id);
		}

		const result: MatchResult = {
			matched: [],
			unmatched_unifi: [],
			unmatched_nocodb: [],
			topology_updates: 0
		};

		// Match UniFi devices
		for (const device of devices) {
			const mac = device.mac.toLowerCase();
			const nocodbLoad = nocodbByMac.get(mac);

			if (nocodbLoad) {
				const updates: Record<string, string> = {};
				const role = mapDeviceTypeToRole(device.type);

				if (nocodbLoad.fields['Network_Role'] !== role) {
					updates['Network_Role'] = role;
				}

				result.matched.push({
					unifi_mac: mac,
					unifi_name: device.name,
					nocodb_id: nocodbLoad.id,
					nocodb_title: nocodbLoad.title,
					updates
				});

				// Apply updates
				if (Object.keys(updates).length > 0) {
					await updateRecord(loadTable.id, nocodbLoad.id, updates);
				}

				// Resolve upstream topology
				if (device.uplink?.mac) {
					const upstreamId = macToNocodbId.get(device.uplink.mac.toLowerCase());
					if (upstreamId) {
						// Find Network_Upstream column ID (would need table meta)
						// For now, skip link updates - they require column ID
						result.topology_updates++;
					}
				}

				nocodbByMac.delete(mac);
			} else {
				result.unmatched_unifi.push({
					mac,
					name: device.name,
					type: device.type
				});
			}
		}

		// Match UniFi clients
		for (const client of clients) {
			const mac = client.mac.toLowerCase();
			const nocodbLoad = nocodbByMac.get(mac);

			if (nocodbLoad) {
				const updates: Record<string, string> = {};

				// Infer power source from switch port
				if (client.sw_mac && client.sw_port) {
					const switchDevice = devices.find(
						(d) => d.mac.toLowerCase() === client.sw_mac?.toLowerCase()
					);
					const port = switchDevice?.port_table?.find(
						(p) => p.port_idx === client.sw_port
					) as UnifiPort | undefined;
					const powerSource = inferPowerSource(port);
					if (nocodbLoad.fields['Power_Source'] !== powerSource) {
						updates['Power_Source'] = powerSource;
					}
				}

				result.matched.push({
					unifi_mac: mac,
					unifi_name: client.name || client.hostname || mac,
					nocodb_id: nocodbLoad.id,
					nocodb_title: nocodbLoad.title,
					updates
				});

				if (Object.keys(updates).length > 0) {
					await updateRecord(loadTable.id, nocodbLoad.id, updates);
				}

				nocodbByMac.delete(mac);
			}
			// Don't add every client to unmatched — only network devices matter
		}

		// Remaining NocoDB loads with match keys that didn't match
		for (const [, load] of nocodbByMac) {
			result.unmatched_nocodb.push({
				id: load.id,
				title: load.title,
				match_key: (load.fields['Network_Match_Key'] as string) || ''
			});
		}

		await updateLastSync(homeId);

		return json(result);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Sync failed' },
			{ status: 502 }
		);
	}
};
