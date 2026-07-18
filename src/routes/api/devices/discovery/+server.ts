import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDevices, getClients, mapDeviceTypeToRole, inferPowerSource } from '$lib/server/unifi';
import type { UnifiPort } from '$lib/server/unifi';
import { getHADevices, getHAAreas } from '$lib/server/ha-devices';
import { isConfigured as isHAConfigured } from '$lib/server/ha-transport';
import { getUnifiConfig } from '$lib/server/unifi-config';
import { listTables, getRecords } from '$lib/server/nocodb';
import { getIgnoredDevices, type DiscoveryItem, type DiscoveryResponse } from '$lib/server/discovery-state';
import { fuzzyScore, findBestMatches } from '$lib/server/fuzzy-match';
import { inferDeviceCategory, inferCategoryFromHA } from '$lib/server/device-category';
import { unifiCache, haCache } from '$lib/server/cache';

function inferArea(deviceName: string, areas: Array<{ id: number; name: string }>): { id: number; name: string } | null {
	const lower = deviceName.toLowerCase();
	let best: { id: number; name: string; len: number } | null = null;
	for (const area of areas) {
		const areaLower = area.name.toLowerCase();
		if (lower.startsWith(areaLower) || lower.includes(areaLower)) {
			if (!best || area.name.length > best.len) {
				best = { id: area.id, name: area.name, len: area.name.length };
			}
		}
	}
	return best ? { id: best.id, name: best.name } : null;
}

export const GET: RequestHandler = async ({ url }) => {
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;
	try {
		const ignoredDevices = await getIgnoredDevices();

		// Fetch NocoDB loads + areas
		const tables = await listTables();
		const loadTable = tables.find((t) => t.title.toLowerCase() === 'load');
		const areaTable = tables.find((t) => t.title.toLowerCase() === 'area');
		if (!loadTable) {
			return json({ error: 'Load table not found' }, { status: 500 });
		}

		const [loads, areas] = await Promise.all([
			getRecords(loadTable.id, { pageSize: '500' }),
			areaTable ? getRecords(areaTable.id, { pageSize: '200' }) : Promise.resolve([])
		]);

		const areaList = areas.map((a) => ({
			id: a.id,
			name: (a.fields['Name'] as string || '').trim()
		})).filter((a) => a.name);

		// Build lookup maps for matching
		const loadByMac = new Map<string, { id: number; title: string }>();
		const loadByHaId = new Map<string, { id: number; title: string }>();
		const loadsWithoutKeys: Array<{ id: number; title: string; areaName?: string }> = [];

		for (const load of loads) {
			const title = (load.fields['Display Name'] as string || load.fields['Name'] as string || '').trim();
			const mac = (load.fields['Network_Match_Key'] as string || '').trim().toLowerCase();
			const haId = (load.fields['HA_Device_Id'] as string || '').trim();

			if (mac) loadByMac.set(mac, { id: load.id, title: title || `Load #${load.id}` });
			if (haId) loadByHaId.set(haId, { id: load.id, title: title || `Load #${load.id}` });
			if (!mac && !haId && title) {
				const areaLink = load.fields['Area'] as { id: number } | undefined;
				const area = areaLink ? areaList.find(a => a.id === areaLink.id) : undefined;
				loadsWithoutKeys.push({ id: load.id, title, areaName: area?.name });
			}
		}

		const results: DiscoveryItem[] = [];
		let unifiConnected = false;
		let haConnected = false;

		// --- UniFi Discovery ---
		const unifiConfig = await getUnifiConfig(homeId);
		if (unifiConfig.url) {
			try {
				const cacheKey = `unifi:${homeId ?? 'default'}`;
				let devices: any[], clients: any[];
				const cached = unifiCache.get(cacheKey);
				if (cached) {
					devices = cached.devices as any[];
					clients = cached.clients as any[];
				} else {
					[devices, clients] = await Promise.all([getDevices(homeId), getClients(homeId)]);
					unifiCache.set(cacheKey, { clients, devices });
				}
				unifiConnected = true;

				// Process UniFi infrastructure devices (APs, switches, etc.)
				for (const device of devices) {
					const mac = device.mac.toLowerCase();
					if (loadByMac.has(mac)) continue; // Already matched
					if (ignoredDevices.has(`unifi:${mac}`)) continue;

					const name = device.name || mac;
					const item: DiscoveryItem = {
						id: `unifi:${mac}`,
						source: 'unifi',
						externalId: mac,
						name,
						type: device.type || 'device',
						ip: device.ip,
						manufacturer: device.model ? 'Ubiquiti' : undefined,
						model: device.model,
						isOnline: true,
						powerSource: 'Circuit',
						inferredCategory: 'networking',
						status: 'unmatched',
						metadata: {
							role: mapDeviceTypeToRole(device.type),
							upstream_mac: device.uplink?.uplink_mac || null,
							is_wired: true
						}
					};

					// Try fuzzy match
					let bestMatch: { id: number; title: string; score: number; reason: string } | null = null;
					for (const candidate of loadsWithoutKeys) {
						const score = fuzzyScore(name, candidate.title);
						if (score >= 0.4 && (!bestMatch || score > bestMatch.score)) {
							bestMatch = { id: candidate.id, title: candidate.title, score, reason: `Name similarity: "${name}" ↔ "${candidate.title}"` };
						}
					}

					if (bestMatch) {
						item.status = 'suggested';
						item.suggestion = { loadId: bestMatch.id, loadName: bestMatch.title, confidence: bestMatch.score, reason: bestMatch.reason };
					}

					const area = inferArea(name, areaList);
					if (area) { item.inferredAreaId = area.id; item.inferredAreaName = area.name; }
					results.push(item);
				}

				// Process UniFi wired clients
				for (const client of clients) {
					if (!client.is_wired) continue;
					const mac = client.mac.toLowerCase();
					if (loadByMac.has(mac)) continue;
					if (ignoredDevices.has(`unifi:${mac}`)) continue;

					const name = client.name || client.hostname || client.oui || mac;
					let powerSource = 'Circuit';
					if (client.sw_mac && client.sw_port) {
						const switchDevice = devices.find((d) => d.mac.toLowerCase() === client.sw_mac?.toLowerCase());
						const port = switchDevice?.port_table?.find((p: UnifiPort) => p.port_idx === client.sw_port) as UnifiPort | undefined;
						powerSource = inferPowerSource(port);
					}

					const item: DiscoveryItem = {
						id: `unifi:${mac}`,
						source: 'unifi',
						externalId: mac,
						name,
						type: 'client',
						ip: client.ip,
						manufacturer: client.oui || undefined,
						isOnline: true,
						powerSource,
						inferredCategory: 'other',
						status: 'unmatched',
						metadata: {
							role: 'Client Device',
							upstream_mac: client.sw_mac || null,
							is_wired: true,
							sw_port: client.sw_port
						}
					};

					let bestMatch: { id: number; title: string; score: number; reason: string } | null = null;
					for (const candidate of loadsWithoutKeys) {
						const score = fuzzyScore(name, candidate.title);
						if (score >= 0.4 && (!bestMatch || score > bestMatch.score)) {
							bestMatch = { id: candidate.id, title: candidate.title, score, reason: `Name similarity: "${name}" ↔ "${candidate.title}"` };
						}
					}

					if (bestMatch) {
						item.status = 'suggested';
						item.suggestion = { loadId: bestMatch.id, loadName: bestMatch.title, confidence: bestMatch.score, reason: bestMatch.reason };
					}

					const area = inferArea(name, areaList);
					if (area) { item.inferredAreaId = area.id; item.inferredAreaName = area.name; }
					results.push(item);
				}
			} catch {
				// UniFi unavailable — skip gracefully
			}
		}

		// --- Home Assistant Discovery ---
		const haConfigured = await isHAConfigured(homeId);
		if (haConfigured) {
			try {
				const cacheKey = `ha:${homeId ?? 'default'}`;
				let haDevices: any[], haAreas: any[];
				const cachedHA = haCache.get(cacheKey);
				if (cachedHA) {
					haDevices = cachedHA.devices as any[];
					haAreas = cachedHA.areas as any[];
				} else {
					[haDevices, haAreas] = await Promise.all([getHADevices(false, homeId), getHAAreas(false, homeId)]);
					haCache.set(cacheKey, { devices: haDevices, areas: haAreas });
				}
				haConnected = true;

				const haAreaMap = new Map(haAreas.map((a: any) => [a.area_id, a.name]));

				for (const haDevice of haDevices) {
					if (haDevice.disabled_by) continue;
					if (haDevice.entry_type === 'service') continue;

					const haId = haDevice.id;
					if (loadByHaId.has(haId)) continue;
					if (ignoredDevices.has(`ha:${haId}`)) continue;

					// Check if HA device has a MAC that's already matched
					const haMACs = haDevice.connections
							.filter(([type]: [string, string]) => type === 'mac')
							.map(([, mac]: [string, string]) => mac.toLowerCase());
						if (haMACs.some((mac: string) => loadByMac.has(mac))) continue;

					const name = haDevice.name_by_user || haDevice.name || haId;
					const areaName = haDevice.area_id ? haAreaMap.get(haDevice.area_id) || null : null;

					const item: DiscoveryItem = {
						id: `ha:${haId}`,
						source: 'ha',
						externalId: haId,
						name,
						type: haDevice.model || 'device',
						manufacturer: haDevice.manufacturer || undefined,
						model: haDevice.model || undefined,
						isOnline: true,
						inferredCategory: inferCategoryFromHA(haDevice),
						status: 'unmatched',
						metadata: {
							area_id: haDevice.area_id,
							area_name: areaName,
							via_device_id: haDevice.via_device_id,
							sw_version: haDevice.sw_version,
							connections: haDevice.connections,
							identifiers: haDevice.identifiers
						}
					};

					// Infer NocoDB area from HA area name
					if (areaName) {
						const area = inferArea(areaName, areaList);
						if (area) { item.inferredAreaId = area.id; item.inferredAreaName = area.name; }
					}
					if (!item.inferredAreaId) {
						const area = inferArea(name, areaList);
						if (area) { item.inferredAreaId = area.id; item.inferredAreaName = area.name; }
					}

					// Try fuzzy match to existing loads
					let bestMatch: { id: number; title: string; score: number; reason: string } | null = null;
					for (const candidate of loadsWithoutKeys) {
						const score = fuzzyScore(name, candidate.title);
						if (score >= 0.4 && (!bestMatch || score > bestMatch.score)) {
							bestMatch = { id: candidate.id, title: candidate.title, score, reason: `Name similarity: "${name}" ↔ "${candidate.title}"` };
						}
					}
					// Also try matching by HA area → NocoDB area
					if (!bestMatch && areaName) {
						for (const candidate of loadsWithoutKeys) {
							if (candidate.areaName?.toLowerCase() === areaName.toLowerCase()) {
								const score = fuzzyScore(name, candidate.title);
								if (score >= 0.3 && (!bestMatch || score > bestMatch.score)) {
									bestMatch = { id: candidate.id, title: candidate.title, score: score + 0.1, reason: `Same area "${areaName}" + name similarity` };
								}
							}
						}
					}

					if (bestMatch) {
						item.status = 'suggested';
						item.suggestion = { loadId: bestMatch.id, loadName: bestMatch.title, confidence: bestMatch.score, reason: bestMatch.reason };
					}

					results.push(item);
				}
			} catch {
				// HA unavailable — skip gracefully
			}
		}

		// Filter out ignored
		const visibleItems = results.filter(r => !ignoredDevices.has(r.id));

		// Build available loads list (unmatched loads for the "link to" UI)
		const matchedLoadIds = new Set(
			visibleItems.filter((r) => r.suggestion).map((r) => r.suggestion!.loadId)
		);
		const availableLoads = loads
			.map((l) => {
				const title = (l.fields['Display Name'] as string) || (l.fields['Name'] as string) || `Load #${l.id}`;
				const areaLink = l.fields['Area'] as { id: number } | undefined;
				const area = areaLink ? areaList.find(a => a.id === areaLink.id) : undefined;
				return { id: l.id, title, areaName: area?.name };
			})
			.filter((l) => !matchedLoadIds.has(l.id) && !l.title.startsWith('Load #'))
			.sort((a, b) => a.title.localeCompare(b.title));

		const response: DiscoveryResponse = {
			items: visibleItems,
			availableLoads,
			areas: areaList,
			summary: {
				suggested: visibleItems.filter(r => r.status === 'suggested').length,
				unmatched: visibleItems.filter(r => r.status === 'unmatched').length,
				ignored: ignoredDevices.size,
				total: visibleItems.length
			},
			sources: { unifi: unifiConnected, ha: haConnected }
		};

		return json(response);
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Discovery failed' },
			{ status: 502 }
		);
	}
};
