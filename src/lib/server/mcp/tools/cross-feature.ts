/**
 * Cross-feature tools — bridge HA energy, HA devices, and UniFi into the chat.
 * B1: get_energy_reading  (read) — live power draw for circuit/room/home
 * B2: get_device_status   (read) — HA entity state lookup
 * B3: get_network_device  (read) — UniFi client/AP status
 */

import type { ToolDefinition, ToolResponse } from '../types';
import { getHomeContext } from '../types';
import { getEntityMappings } from '$lib/server/energy-mappings';
import { getCircuitReadings, getSolarReading, calculateCost } from '$lib/server/ha-energy';
import { checkConnection as checkHAConnection } from '$lib/server/ha-energy';
import * as haClient from '$lib/server/ha-client';
import * as unifi from '$lib/server/unifi';
import { db } from '$lib/server/db';
import { findBestMatches } from '$lib/server/fuzzy-match';

// ─── B1: get_energy_reading ──────────────────────────────────────────────────

export const getEnergyReading: ToolDefinition = {
	name: 'get_energy_reading',
	description:
		'Get current live power draw (watts) and cost estimate. Can scope to a specific circuit, room, or the whole home. ' +
		'Use when user asks "how much power is the kitchen using?", "what\'s my electric bill looking like?", or "is circuit 7 drawing a lot?"',
	category: 'read',
	parameters: {
		scope: {
			type: 'string',
			description: 'What to measure: "circuit", "room", or "home"',
			required: true,
			enum: ['circuit', 'room', 'home']
		},
		circuit_number: {
			type: 'number',
			description: 'Circuit number (required when scope=circuit)'
		},
		room_name: {
			type: 'string',
			description: 'Room name (required when scope=room)'
		},
		panel_name: {
			type: 'string',
			description: 'Panel name (optional, for multi-panel homes)'
		}
	},
	async execute(args): Promise<ToolResponse> {
		const home = getHomeContext(args);
		const scope = String(args.scope);

		// Validate scope
		if (!['circuit', 'room', 'home'].includes(scope)) {
			return { success: false, error: 'scope must be "circuit", "room", or "home"' };
		}

		// Check HA connection
		const haUp = await checkHAConnection(home?.homeId);
		if (!haUp) {
			return { success: false, error: 'Home Assistant is not connected. Energy readings require a live HA connection.' };
		}

		// Get all entity mappings
		const mappings = await getEntityMappings();
		if (mappings.length === 0) {
			return { success: false, error: 'No energy entity mappings configured. Map circuits to HA entities in Settings → Energy.' };
		}

		if (scope === 'circuit') {
			const circuitNum = Number(args.circuit_number);
			if (!Number.isInteger(circuitNum) || circuitNum <= 0) {
				return { success: false, error: 'circuit_number is required (positive integer) when scope is "circuit"' };
			}

			// Resolve circuit number → circuit ID via the database
			const panelName = args.panel_name as string | undefined;
			let circuit;
			if (home && !panelName) {
				const panels = await db.getPanels(home.homeId);
				const matches = [];
				for (const panel of panels) {
					const circuits = await db.getCircuits(panel.id);
					const match = circuits.find(c => c.number === circuitNum);
					if (match) matches.push({ circuit: match, panelName: panel.name });
				}
				if (matches.length === 1) circuit = matches[0].circuit;
				else if (matches.length > 1) {
					return { success: false, error: `Circuit #${circuitNum} exists in multiple panels: ${matches.map(m => m.panelName).join(', ')}. Which panel?` };
				}
			} else {
				circuit = await db.getCircuitByNumber(circuitNum, panelName);
			}

			// Find mapping by circuit ID (preferred) or by name pattern
			const mapping = circuit
				? mappings.find(m => m.circuitId === circuit!.id)
				: mappings.find(m => m.circuitName.includes(String(circuitNum)));

			if (!mapping) {
				return { success: false, error: `No energy monitoring configured for circuit #${circuitNum}. Map it in Settings → Energy.` };
			}

			const readings = await getCircuitReadings([mapping], undefined, home?.homeId);
			if (readings.length === 0) {
				return { success: false, error: `No live reading available for circuit #${circuitNum}` };
			}

			const reading = readings[0];
			const cost = calculateCost(reading.watts);

			return {
				success: true,
				data: {
					scope: 'circuit',
					circuit: {
						number: circuitNum,
						name: reading.circuitName,
						panel: reading.panelName
					},
					reading: {
						watts: Math.round(reading.watts),
						trend: reading.trend,
						capacityPercent: reading.capacityPercent
					},
					cost: {
						estimatedDailyCost: `$${cost.dailyCost.toFixed(2)}`,
						estimatedMonthlyCost: `$${cost.monthlyCost.toFixed(2)}`,
						ratePerKwh: `$${cost.ratePerKwh.toFixed(3)}`
					}
				}
			};
		}

		if (scope === 'room') {
			const roomName = typeof args.room_name === 'string' ? args.room_name.trim() : '';
			if (!roomName) {
				return { success: false, error: 'room_name is required when scope is "room"' };
			}

			// Find the room
			const room = await db.getRoomByName(roomName, home?.homeId);
			if (!room) {
				const rooms = await db.getRooms(home?.homeId);
				const matches = findBestMatches(roomName, rooms, r => r.name, { threshold: 0.25, maxResults: 3 });
				if (matches.length > 0) {
					return { success: false, error: `No exact match for "${roomName}". Did you mean: ${matches.map(m => m.label).join(', ')}?` };
				}
				return { success: false, error: `Room "${roomName}" not found` };
			}

			// Get circuits serving this room
			const loads = await db.getLoads(undefined, room.id);
			const receptacles = await db.getReceptacles(undefined, room.id);
			const circuitIds = new Set<number>();
			for (const l of loads) if (l.circuitId) circuitIds.add(l.circuitId);
			for (const r of receptacles) if (r.circuitId) circuitIds.add(r.circuitId);

			// Filter mappings to those circuits
			const roomMappings = mappings.filter(m => circuitIds.has(m.circuitId));
			if (roomMappings.length === 0) {
				return {
					success: false,
					error: `No energy-monitored circuits found for "${roomName}". The room's circuits may not have HA entity mappings.`
				};
			}

			const readings = await getCircuitReadings(roomMappings, undefined, home?.homeId);
			const totalWatts = readings.reduce((sum, r) => sum + r.watts, 0);
			const cost = calculateCost(totalWatts);

			return {
				success: true,
				data: {
					scope: 'room',
					room: room.name,
					totalWatts: Math.round(totalWatts),
					circuits: readings.map(r => ({
						name: r.circuitName,
						watts: Math.round(r.watts),
						trend: r.trend,
						capacityPercent: r.capacityPercent
					})),
					cost: {
						estimatedDailyCost: `$${cost.dailyCost.toFixed(2)}`,
						estimatedMonthlyCost: `$${cost.monthlyCost.toFixed(2)}`,
						ratePerKwh: `$${cost.ratePerKwh.toFixed(3)}`
					}
				}
			};
		}

		// scope === 'home'
		const readings = await getCircuitReadings(mappings, undefined, home?.homeId);
		const totalWatts = readings.reduce((sum, r) => sum + r.watts, 0);
		const cost = calculateCost(totalWatts);
		const solar = await getSolarReading(home?.homeId);

		return {
			success: true,
			data: {
				scope: 'home',
				home: home?.homeName || 'All homes',
				totalWatts: Math.round(totalWatts),
				monitoredCircuits: readings.length,
				topConsumers: [...readings].sort((a, b) => b.watts - a.watts).slice(0, 5).map(r => ({
					name: r.circuitName,
					watts: Math.round(r.watts),
					panel: r.panelName
				})),
				solar: solar
					? {
						productionWatts: Math.round(solar.production),
						todayWh: Math.round(solar.todayWh),
						gridImportW: Math.round(solar.gridImportW),
						gridExportW: Math.round(solar.gridExportW),
						netWatts: Math.round(totalWatts - solar.production)
					}
					: null,
				cost: {
					estimatedDailyCost: `$${cost.dailyCost.toFixed(2)}`,
					estimatedMonthlyCost: `$${cost.monthlyCost.toFixed(2)}`,
					ratePerKwh: `$${cost.ratePerKwh.toFixed(3)}`
				}
			}
		};
	}
};

// ─── B2: get_device_status ───────────────────────────────────────────────────

export const getDeviceStatus: ToolDefinition = {
	name: 'get_device_status',
	description:
		'Get the current state of a Home Assistant entity (on/off, temperature, brightness, etc.). ' +
		'Use when user asks "is the living room light on?", "what\'s the thermostat set to?", or "check the garage door".',
	category: 'read',
	parameters: {
		entity_id: {
			type: 'string',
			description: 'HA entity ID (e.g., "light.living_room", "climate.thermostat"). Provide this if known.'
		},
		device_name: {
			type: 'string',
			description: 'Friendly device name to search for (e.g., "living room light", "thermostat"). Used when entity_id is unknown.'
		},
		domain: {
			type: 'string',
			description: 'Optional HA domain filter (e.g., "light", "switch", "climate", "sensor", "binary_sensor")'
		}
	},
	async execute(args): Promise<ToolResponse> {
		const configured = await haClient.isConfigured();
		if (!configured) {
			return { success: false, error: 'Home Assistant integration is not configured. Set it up in Settings → Home Assistant.' };
		}

		const entityId = args.entity_id as string | undefined;
		const deviceName = args.device_name as string | undefined;
		const domain = args.domain as string | undefined;

		if (!entityId && !deviceName) {
			return { success: false, error: 'Provide either entity_id or device_name to look up a device.' };
		}

		try {
			// Direct lookup by entity_id
			if (entityId) {
				const entity = await haClient.getEntity(entityId);
				if (!entity) {
					return { success: false, error: `Entity "${entityId}" not found in Home Assistant.` };
				}
				return { success: true, data: formatEntityState(entity) };
			}

			// Search by friendly name
			const entities = await haClient.getEntities({ domain });
			const matches = findBestMatches(
				deviceName!,
				entities,
				(e) => (e.attributes?.friendly_name as string) || e.entity_id,
				{ threshold: 0.2, maxResults: 5 }
			);

			if (matches.length === 0) {
				return { success: false, error: `No devices found matching "${deviceName}"${domain ? ` in domain "${domain}"` : ''}.` };
			}

			// If top match is strong, return it directly
			if (matches.length === 1 || matches[0].score > 0.8) {
				return { success: true, data: formatEntityState(matches[0].item) };
			}

			// Multiple matches — return all for disambiguation
			return {
				success: true,
				data: {
					query: deviceName,
					matchCount: matches.length,
					matches: matches.map(m => formatEntityState(m.item))
				}
			};
		} catch (err) {
			return { success: false, error: `Home Assistant lookup failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
		}
	}
};

function formatEntityState(entity: haClient.HAEntityState) {
	const attrs = entity.attributes || {};
	const result: Record<string, unknown> = {
		entityId: entity.entity_id,
		friendlyName: (attrs.friendly_name as string) || entity.entity_id,
		state: entity.state,
		lastChanged: entity.last_changed
	};

	// Include domain-specific attributes
	const domain = entity.entity_id.split('.')[0];

	if (domain === 'light') {
		if (attrs.brightness !== undefined) result.brightness = Math.round((Number(attrs.brightness) / 255) * 100);
		if (attrs.color_temp_kelvin !== undefined) result.colorTempK = attrs.color_temp_kelvin;
		if (attrs.color_mode !== undefined) result.colorMode = attrs.color_mode;
	} else if (domain === 'climate') {
		if (attrs.temperature !== undefined) result.targetTemp = attrs.temperature;
		if (attrs.current_temperature !== undefined) result.currentTemp = attrs.current_temperature;
		if (attrs.hvac_action !== undefined) result.hvacAction = attrs.hvac_action;
		if (attrs.preset_mode !== undefined) result.presetMode = attrs.preset_mode;
	} else if (domain === 'sensor' || domain === 'binary_sensor') {
		if (attrs.unit_of_measurement !== undefined) result.unit = attrs.unit_of_measurement;
		if (attrs.device_class !== undefined) result.deviceClass = attrs.device_class;
	} else if (domain === 'cover') {
		if (attrs.current_position !== undefined) result.position = attrs.current_position;
	} else if (domain === 'fan') {
		if (attrs.percentage !== undefined) result.speedPercent = attrs.percentage;
		if (attrs.preset_mode !== undefined) result.presetMode = attrs.preset_mode;
	}

	return result;
}

// ─── B3: get_network_device ──────────────────────────────────────────────────

export const getNetworkDevice: ToolDefinition = {
	name: 'get_network_device',
	description:
		'Look up a network device or client on the UniFi network. Shows connection status, IP, uptime, and switch port. ' +
		'Use when user asks "is the camera online?", "what\'s connected to port 5?", or "find my printer on the network".',
	category: 'read',
	parameters: {
		device_name: {
			type: 'string',
			description: 'Device name or hostname to search for (e.g., "camera", "printer", "office AP")'
		},
		mac: {
			type: 'string',
			description: 'MAC address for exact lookup'
		},
		type: {
			type: 'string',
			description: 'Filter by type: "infrastructure" (APs, switches, gateways) or "client" (connected devices)',
			enum: ['infrastructure', 'client']
		}
	},
	async execute(args): Promise<ToolResponse> {
		const home = getHomeContext(args);
		const deviceName = args.device_name as string | undefined;
		const mac = args.mac as string | undefined;
		const typeFilter = args.type as string | undefined;

		if (!deviceName && !mac) {
			return { success: false, error: 'Provide either device_name or mac to look up a network device.' };
		}

		try {
			// MAC-based exact lookup
			if (mac) {
				// Try infrastructure device first
				const device = await unifi.getDevice(mac, home?.homeId);
				if (device) {
					return { success: true, data: formatUnifiDevice(device) };
				}

				// Try clients
				const clients = await unifi.getClients(home?.homeId);
				const client = clients.find(c => c.mac.toLowerCase() === mac.toLowerCase());
				if (client) {
					return { success: true, data: formatUnifiClient(client) };
				}

				return { success: false, error: `No device found with MAC "${mac}"` };
			}

			// Name-based search
			const results: Array<{ type: string; data: Record<string, unknown>; score: number }> = [];

			if (typeFilter !== 'client') {
				const devices = await unifi.getDevices(home?.homeId);
				const deviceMatches = findBestMatches(
					deviceName!,
					devices,
					(d) => d.name || d.model,
					{ threshold: 0.2, maxResults: 5 }
				);
				for (const m of deviceMatches) {
					results.push({ type: 'infrastructure', data: formatUnifiDevice(m.item), score: m.score });
				}
			}

			if (typeFilter !== 'infrastructure') {
				const clients = await unifi.getClients(home?.homeId);
				const clientMatches = findBestMatches(
					deviceName!,
					clients,
					(c) => c.name || c.hostname || c.mac,
					{ threshold: 0.2, maxResults: 5 }
				);
				for (const m of clientMatches) {
					results.push({ type: 'client', data: formatUnifiClient(m.item), score: m.score });
				}
			}

			// Sort by score and return
			results.sort((a, b) => b.score - a.score);

			if (results.length === 0) {
				return { success: false, error: `No network devices found matching "${deviceName}"` };
			}

			if (results.length === 1 || results[0].score > 0.8) {
				return { success: true, data: results[0].data };
			}

			return {
				success: true,
				data: {
					query: deviceName,
					matchCount: results.length,
					matches: results.slice(0, 5).map(r => r.data)
				}
			};
		} catch (err) {
			return { success: false, error: `UniFi lookup failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
		}
	}
};

function formatUnifiDevice(device: unifi.UnifiDevice): Record<string, unknown> {
	const result: Record<string, unknown> = {
		type: 'infrastructure',
		name: device.name,
		model: device.model,
		mac: device.mac,
		ip: device.ip,
		role: unifi.mapDeviceTypeToRole(device.type),
		status: device.state === 1 ? 'online' : 'offline',
		adopted: device.adopted,
		firmwareVersion: device.version
	};

	if (device.system_stats) {
		result.cpu = `${device.system_stats.cpu}%`;
		result.memory = `${device.system_stats.mem}%`;
		result.uptime = formatUptime(Number(device.system_stats.uptime));
	}

	if (device.port_table) {
		const activePorts = device.port_table.filter(p => p.up);
		result.totalPorts = device.port_table.length;
		result.activePorts = activePorts.length;
	}

	return result;
}

function formatUnifiClient(client: unifi.UnifiClient): Record<string, unknown> {
	return {
		type: 'client',
		name: client.name || client.hostname || client.mac,
		hostname: client.hostname,
		mac: client.mac,
		ip: client.ip,
		connectionType: client.is_wired ? 'wired' : 'wireless',
		network: client.network,
		isGuest: client.is_guest,
		uptime: formatUptime(client.uptime),
		lastSeen: new Date(client.last_seen * 1000).toISOString(),
		switchMac: client.sw_mac,
		switchPort: client.sw_port
	};
}

function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

/** All cross-feature read tools */
export const crossFeatureReadTools: ToolDefinition[] = [
	getEnergyReading,
	getDeviceStatus,
	getNetworkDevice
];
