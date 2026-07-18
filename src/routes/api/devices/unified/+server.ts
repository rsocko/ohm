import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClients, getDevices } from '$lib/server/unifi';
import { getHADevices, getHAAreas } from '$lib/server/ha-devices';
import { isConfigured as isHAConfigured } from '$lib/server/ha-transport';
import { getUnifiConfig } from '$lib/server/unifi-config';
import { listTables, getRecords } from '$lib/server/nocodb';
import { inferDeviceCategory, resolveDeviceIcon } from '$lib/server/device-category';
import { unifiCache, haCache } from '$lib/server/cache';
import type { UnifiedDevice } from '$lib/types/unified';

export type { UnifiedDevice } from '$lib/types/unified';

export const GET: RequestHandler = async ({ url }) => {
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;
	try {
		// Resolve NocoDB table IDs
		const tables = await listTables();
		const loadTable = tables.find(t => t.title.toLowerCase() === 'load');
		const areaTable = tables.find(t => t.title.toLowerCase() === 'area');
		const circuitTable = tables.find(t => t.title.toLowerCase() === 'circuit');
		const panelTable = tables.find(t => t.title.toLowerCase() === 'panel');

		// Fetch ALL data sources in parallel — don't let one slow source block others
		const [nocoResult, unifiResult, haResult] = await Promise.all([
			// NocoDB loads + areas + circuits + panels (direct module calls)
			Promise.all([
				loadTable ? getRecords(loadTable.id, { pageSize: '500' }).catch(() => []) : Promise.resolve([]),
				areaTable ? getRecords(areaTable.id, { pageSize: '500' }).catch(() => []) : Promise.resolve([]),
				circuitTable ? getRecords(circuitTable.id, { pageSize: '500' }).catch(() => []) : Promise.resolve([]),
				panelTable ? getRecords(panelTable.id, { pageSize: '500' }).catch(() => []) : Promise.resolve([])
			]),
			// UniFi clients + devices (cached, 60s TTL)
			(async () => {
				const cacheKey = `unifi:${homeId ?? 'default'}`;
				const cached = unifiCache.get(cacheKey);
				if (cached) return { ...cached, up: true };
				try {
					const config = await getUnifiConfig(homeId);
					if (!config.url || !config.username) return { clients: [], devices: [], up: false };
					const [clients, devices] = await Promise.all([getClients(homeId), getDevices(homeId)]);
					unifiCache.set(cacheKey, { clients, devices });
					return { clients, devices, up: true };
				} catch { return { clients: [], devices: [], up: false }; }
			})(),
			// HA devices + areas (cached, 120s TTL)
			(async () => {
				const cacheKey = `ha:${homeId ?? 'default'}`;
				const cached = haCache.get(cacheKey);
				if (cached) return { ...cached, up: true };
				try {
					const configured = await isHAConfigured(homeId);
					if (!configured) return { devices: [], areas: [], up: false };
					const [devices, areas] = await Promise.all([getHADevices(false, homeId), getHAAreas(false, homeId)]);
					haCache.set(cacheKey, { devices, areas });
					return { devices, areas, up: true };
				} catch { return { devices: [], areas: [], up: false }; }
			})()
		]);

		const loads = nocoResult[0];
		const areas = nocoResult[1];
		const circuits = nocoResult[2];
		const panelRecords = nocoResult[3];
		const areaMap = new Map(areas.map(a => [a.id, String(a.fields.Title || a.fields.Name || '')]));
		const panelMap = new Map(panelRecords.map(p => [p.id, String(p.fields.Name || p.fields.Title || '')]));

		// Build reverse lookup: load name → circuit (Circuit has "Load Name(s)" array)
		const loadNameToCircuit = new Map<string, { id: number; fields: Record<string, unknown> }>();
		for (const circuit of circuits) {
			const loadNames = circuit.fields['Load Name(s)'] as string[] | undefined;
			if (Array.isArray(loadNames)) {
				for (const name of loadNames) {
					if (name) loadNameToCircuit.set(name.trim().toLowerCase(), circuit);
				}
			}
		}
		const unifiUp = unifiResult.up;
		const unifiClients = (unifiResult.clients || []).map((c: any) => ({
			mac: c.mac?.toLowerCase(),
			ip: c.ip,
			name: c.name || c.hostname || c.oui || c.mac,
			hostname: c.hostname || '',
			sw_mac: c.sw_mac || null,
			sw_port: c.sw_port || null,
			network: c.network || '',
			is_wired: c.is_wired,
			uptime: c.uptime || 0,
			last_seen: c.last_seen || 0
		}));
		const unifiDevices = (unifiResult.devices || []).map((d: any) => ({
			mac: d.mac?.toLowerCase(),
			name: d.name || d.model || d.mac,
			type: d.type
		}));

		const haUp = haResult.up;
		const haDevices: any[] = haResult.devices || [];
		const haAreas: any[] = haResult.areas || [];
		const haAreaMap = new Map(haAreas.map((a: any) => [a.area_id, a.name]));

		// Build UniFi lookup by MAC
		const unifiByMac = new Map(unifiClients.map(c => [c.mac, c]));
		// Also add UniFi infrastructure devices
		for (const d of unifiDevices) {
			if (!unifiByMac.has(d.mac)) {
				unifiByMac.set(d.mac, {
					mac: d.mac, ip: '', name: d.name, hostname: '',
					sw_mac: null, sw_port: null, network: '',
					is_wired: true, uptime: 0, last_seen: Date.now() / 1000
				});
			}
		}

		// Build HA lookup by device_id AND by MAC
		const haByMac = new Map<string, any>();
		const haById = new Map<string, any>();
		for (const d of haDevices) {
			haById.set(d.id, d);
			for (const [type, value] of d.connections as [string, string][]) {
				if (type === 'mac') haByMac.set(value.toLowerCase(), d);
			}
		}

		// Merge: iterate NocoDB loads and enrich
		const unified: UnifiedDevice[] = [];
		const matchedUnifiMacs = new Set<string>();
		const matchedHaIds = new Set<string>();

		for (const load of loads) {
			const f = load.fields;
			const mac = String(f.Network_Match_Key || '').toLowerCase().trim();
			const haDeviceId = String(f.HA_Device_Id || '').trim();
			const loadName = String(f.Title || f.Name || f['Display Name'] || 'Unknown');

			// Area resolution: field is either { id, fields: { Name } } object or numeric ID
			const areaObj = f.Area as { id: number; fields?: { Name?: string } } | undefined;
			const areaIdNum = f.Area_id as number | undefined;
			const areaId = areaObj?.id || areaIdNum;
			const areaName = areaObj?.fields?.Name || (areaId ? areaMap.get(areaId) : undefined);

			const device: UnifiedDevice = {
				id: String(load.id),
				name: loadName,
					icon: resolveDeviceIcon(f),
						deviceCategory: inferDeviceCategory(f),
				areaId,
				areaName,
				powerSource: String(f.Power_Source || ''),
				sources: ['nocodb']
			};

			// Circuit info — reverse lookup from Circuit "Load Name(s)" array
			const matchedCircuit = loadNameToCircuit.get(loadName.trim().toLowerCase());
			if (matchedCircuit) {
				const cf = matchedCircuit.fields;
				device.circuitId = String(matchedCircuit.id);
				device.circuitName = String(cf.Name || cf.Number || '');
				const amps = cf.Amps as number | undefined;
				if (amps) device.breakerAmps = amps;
				const panelLink = cf.Panel as { id: number; fields?: { Name?: string } } | undefined;
				if (panelLink) {
					device.panelName = panelLink.fields?.Name || panelMap.get(panelLink.id);
				}
			}

			// UniFi enrichment
			if (mac && unifiByMac.has(mac)) {
				const client = unifiByMac.get(mac)!;
				device.network = {
					mac: client.mac,
					ip: client.ip,
					hostname: client.hostname,
					isOnline: (Date.now() / 1000 - client.last_seen) < 300,
					lastSeen: client.last_seen,
					vlan: client.network,
					uptime: client.uptime,
					switchPort: client.sw_mac && client.sw_port
						? { switchName: client.sw_mac, port: client.sw_port }
						: undefined
				};
				device.sources.push('unifi');
				matchedUnifiMacs.add(mac);
			}

			// HA enrichment — match by HA_Device_Id first, then by MAC
			let haDevice = haDeviceId ? haById.get(haDeviceId) : undefined;
			if (!haDevice && mac) haDevice = haByMac.get(mac);
			if (haDevice) {
				device.homeAssistant = {
					deviceId: haDevice.id,
					manufacturer: haDevice.manufacturer,
					model: haDevice.model,
					swVersion: haDevice.sw_version,
					areaName: haDevice.area_id ? haAreaMap.get(haDevice.area_id) || null : null,
					entityCount: 0,
					isControllable: false,
					viaDevice: haDevice.via_device_id || null
				};
				device.sources.push('ha');
				matchedHaIds.add(haDevice.id);
			}

			unified.push(device);
		}

		// Compute unmatched counts for discovery (only wired UniFi + non-service HA — matches what discovery page shows)
		const unmatchedUnifi = unifiClients.filter(c => c.is_wired && !matchedUnifiMacs.has(c.mac)).length;
		const unmatchedHA = haDevices.filter(d => !matchedHaIds.has(d.id) && !d.disabled_by && d.entry_type !== 'service').length;

		return json({
			devices: unified,
			meta: {
				totalLoads: loads.length,
				unifiConnected: unifiUp,
				haConnected: haUp,
				unmatchedUnifi,
				unmatchedHA,
				discoveryCount: unmatchedUnifi + unmatchedHA
			}
		});
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to build unified device list' },
			{ status: 500 }
		);
	}
};
