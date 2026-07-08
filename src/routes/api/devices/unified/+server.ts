import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClients, getDevices } from '$lib/server/unifi';
import { getHADevices, getHAAreas } from '$lib/server/ha-devices';
import { isConfigured as isHAConfigured } from '$lib/server/ha-transport';
import { getUnifiConfig } from '$lib/server/unifi-config';
import { loadTypeConfig } from '$lib/config/device-types';

export interface UnifiedDevice {
	id: string;
	name: string;
	icon?: string;
	deviceCategory: string;
	circuitId?: string;
	circuitName?: string;
	panelName?: string;
	breakerAmps?: number;
	areaId?: number;
	areaName?: string;
	powerSource?: string;
	network?: {
		mac: string;
		ip: string;
		hostname: string;
		isOnline: boolean;
		lastSeen: number;
		switchPort?: { switchName: string; port: number };
		poePower?: number;
		manufacturer?: string;
		vlan?: string;
		uptime?: number;
	};
	homeAssistant?: {
		deviceId: string;
		manufacturer: string | null;
		model: string | null;
		swVersion: string | null;
		areaName: string | null;
		entityCount: number;
		isControllable: boolean;
		viaDevice?: string | null;
		entities?: string[];
	};
	sources: ('nocodb' | 'unifi' | 'ha')[];
}

export const GET: RequestHandler = async ({ url }) => {
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;
	try {
		// Fetch ALL data sources in parallel — don't let one slow source block others
		const [nocoResult, unifiResult, haResult] = await Promise.all([
			// NocoDB loads + areas + circuits + panels (parallel sub-fetches)
			Promise.all([
				fetch(url.origin + '/api/nocodb?action=records&table=Load&limit=500').then(r => r.json()).catch(() => ({ records: [] })),
					fetch(url.origin + '/api/nocodb?action=records&table=Area&limit=500').then(r => r.json()).catch(() => ({ records: [] })),
					fetch(url.origin + '/api/nocodb?action=records&table=Circuit&limit=500').then(r => r.json()).catch(() => ({ records: [] })),
					fetch(url.origin + '/api/nocodb?action=records&table=Panel&limit=500').then(r => r.json()).catch(() => ({ records: [] }))
			]),
			// UniFi clients + devices (with config check)
			(async () => {
				try {
					const config = await getUnifiConfig(homeId);
					if (!config.url || !config.username) return { clients: [], devices: [], up: false };
					const [clients, devices] = await Promise.all([getClients(homeId), getDevices(homeId)]);
					return { clients, devices, up: true };
				} catch { return { clients: [], devices: [], up: false }; }
			})(),
			// HA devices + areas (with config check, 5s timeout)
			(async () => {
				try {
					const configured = await isHAConfigured(homeId);
					if (!configured) return { devices: [], areas: [], up: false };
					const [devices, areas] = await Promise.all([getHADevices(false, homeId), getHAAreas(false, homeId)]);
					return { devices, areas, up: true };
				} catch { return { devices: [], areas: [], up: false }; }
			})()
		]);

		const loads: Array<{ id: number; fields: Record<string, unknown> }> = nocoResult[0].records || [];
		const areas: Array<{ id: number; fields: Record<string, unknown> }> = nocoResult[1].records || [];
		const circuits: Array<{ id: number; fields: Record<string, unknown> }> = nocoResult[2].records || [];
		const panelRecords: Array<{ id: number; fields: Record<string, unknown> }> = nocoResult[3].records || [];
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
		const haDevices = haResult.devices || [];
		const haAreas = haResult.areas || [];
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
		const haByMac = new Map<string, typeof haDevices[0]>();
		const haById = new Map<string, typeof haDevices[0]>();
		for (const d of haDevices) {
			haById.set(d.id, d);
			for (const [type, value] of d.connections) {
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
					deviceCategory: inferCategory(f),
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

/** Resolve the display icon: use custom override, fall back to type-based default */
function resolveDeviceIcon(fields: Record<string, unknown>): string | undefined {
	const iconField = String(fields.Icon || '').trim();
	// If it's a real icon override (not "Default" or empty), use it
	if (iconField && iconField.toLowerCase() !== 'default' && iconField.includes(':')) {
		return iconField;
	}
	// Fall back to type-based icon from loadTypeConfig
	const deviceType = String(fields['Device Type'] || '');
	const typeConfig = loadTypeConfig[deviceType];
	if (typeConfig) return typeConfig.icon;
	return undefined;
}

function inferCategory(fields: Record<string, unknown>): string {
	const type = String(fields['Device Type'] || '').toLowerCase();
	const role = String(fields.Network_Role || '').toLowerCase();
	const name = String(fields.Title || fields.Name || '').toLowerCase();

	// --- Type-based checks first (most reliable) ---
	if (type === 'networking' || role === 'router' || role === 'switch' || role === 'ap' || role === 'access point') return 'networking';
	if (type === 'camera') return 'camera';
	if (type === 'electronics') return 'media';
	if (type.includes('light') || type.includes('lamp') || type === 'ceiling fan/light') return 'lighting';
	if (type === 'hvac' || type === 'vent fan') return 'climate';
	if (type === 'appliance' || type === 'washer/dryer' || type.includes('washer') || type.includes('dryer')) return 'appliance';
	if (type === 'ev charger') return 'power';
	if (type === 'smoke/co detector' || type === 'doorbell') return 'security';

	// --- Name-based heuristics (fallback) ---
	if (name.includes('camera')) return 'camera';
	if (name.includes('projector') || name.includes('speaker') || name.includes('sonos') || name.includes('receiver') || name.match(/\btv\b/)) return 'media';
	if (name.includes('raspberry') || name.includes('server') || name.includes('nas') || name.includes('desktop') || name.includes('pc') || name.includes('computer')) return 'computing';
	if (name.includes('hub') || name.includes('yolink') || name.includes('zigbee') || name.includes('zwave')) return 'iot-hub';
	if (name.includes('thermostat') || name.includes('ecobee') || name.includes('hvac') || name.includes('furnace') || name.includes('air conditioner') || name.includes('dehumidifier') || name.includes('humidifier')) return 'climate';
	if (name.includes('light') || name.includes('lamp') || name.includes('bulb') || name.includes('sconce') || name.includes('chandelier')) return 'lighting';
	if (name.includes('washer') || name.includes('dryer') || name.includes('fridge') || name.includes('refrigerator') || name.includes('dishwasher') || name.includes('oven') || name.includes('microwave') || name.includes('garbage disposal') || name.includes('range') || name.includes('stove') || name.includes('freezer')) return 'appliance';
	if (name.includes('ups') || name.includes('pdu') || name.includes('plug') || name.includes('ev charger') || name.includes('charger')) return 'power';
	if (name.includes('sensor') || name.includes('motion') || name.includes('leak') || name.includes('smoke') || name.includes('doorbell')) return 'security';
	if (name.includes('fan') || name.includes('exhaust')) return 'climate';

	return 'other';
}
