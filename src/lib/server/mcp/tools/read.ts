/**
 * Read tools — auto-execute, return data immediately.
 * These never require user confirmation.
 * All tools respect _homeContext for scoping queries to the active home.
 */

import type { ToolDefinition, ToolResponse } from '../types';
import { getHomeContext } from '../types';
import { db } from '$lib/server/db';
import { findBestMatches } from '$lib/server/fuzzy-match';

export const whatIsOnCircuit: ToolDefinition = {
	name: 'what_is_on_circuit',
	description: 'Get everything on a specific circuit: loads, receptacles, total estimated draw, and capacity. Use when user asks "what\'s on circuit 7?" or "what does breaker 3 control?"',
	category: 'read',
	parameters: {
		circuit_number: { type: 'number', description: 'Circuit/breaker number', required: true },
		panel_name: { type: 'string', description: 'Panel name (optional, for multi-panel homes)' }
	},
	async execute(args): Promise<ToolResponse> {
		const home = getHomeContext(args);
		const panelName = args.panel_name as string | undefined;

		// If home context exists and no panel specified, check for ambiguity across panels
		let circuit;
		if (home && !panelName) {
			const panels = await db.getPanels(home.homeId);
			const matches = [];
			for (const panel of panels) {
				const circuits = await db.getCircuits(panel.id);
				const match = circuits.find(c => c.number === Number(args.circuit_number));
				if (match) matches.push({ circuit: match, panelName: panel.name });
			}
			if (matches.length === 0) {
				return { success: false, error: `No circuit #${args.circuit_number} found in ${home.homeName}` };
			}
			if (matches.length > 1) {
				return { success: false, error: `Circuit #${args.circuit_number} exists in multiple panels: ${matches.map(m => m.panelName).join(', ')}. Which panel did you mean?` };
			}
			circuit = matches[0].circuit;
		} else {
			circuit = await db.getCircuitByNumber(Number(args.circuit_number), panelName);
		}

		if (!circuit) {
			return { success: false, error: `No circuit #${args.circuit_number} found${panelName ? ` in ${panelName}` : ''}` };
		}

		const loads = await db.getLoads(circuit.id);
		const receptacles = await db.getReceptacles(circuit.id);
		const totalWatts = loads.reduce((sum, l) => sum + (l.wattage || 0), 0);
		const ratedWatts = circuit.amps * 120; // Assume 120V unless we know otherwise

		return {
			success: true,
			data: {
				circuit: {
					id: circuit.id,
					number: circuit.number,
					amps: circuit.amps,
					description: circuit.description,
					gfciProtected: circuit.gfciProtected,
					panel: circuit.panelName,
					room: circuit.roomName
				},
				loads: loads.map(l => ({
					id: l.id, name: l.name, type: l.deviceType,
					wattage: l.wattage, fixtureCount: l.fixtureCount, room: l.roomName
				})),
				receptacles: receptacles.map(r => ({
					id: r.id, name: r.name, type: r.type,
					direction: r.locDirection, room: r.roomName
				})),
				capacity: {
					ratedAmps: circuit.amps,
					ratedWatts,
					estimatedDrawWatts: totalWatts,
					utilizationPercent: ratedWatts > 0 ? Math.round((totalWatts / ratedWatts) * 100) : null,
					headroomWatts: ratedWatts - totalWatts
				}
			}
		};
	}
};

export const getRoomSummary: ToolDefinition = {
	name: 'get_room_summary',
	description: 'Get all electrical info for a room: which circuits serve it, all loads and receptacles. Use when user asks about a specific room.',
	category: 'read',
	parameters: {
		room_name: { type: 'string', description: 'Room/area name (e.g., "Kitchen", "Master Bedroom")', required: true }
	},
	async execute(args): Promise<ToolResponse> {
		const home = getHomeContext(args);
		const room = await db.getRoomByName(String(args.room_name), home?.homeId);
		if (!room) {
			// Try fuzzy match within the active home
			const rooms = await db.getRooms(home?.homeId);
			const matches = findBestMatches(
				String(args.room_name),
				rooms,
				(r) => r.name,
				{ threshold: 0.25, maxResults: 3 }
			);
			if (matches.length > 0) {
				return { success: false, error: `No exact match for "${args.room_name}"${home ? ` in ${home.homeName}` : ''}. Did you mean: ${matches.map(m => m.label).join(', ')}?` };
			}
			return { success: false, error: `No room found matching "${args.room_name}"${home ? ` in ${home.homeName}` : ''}` };
		}

		const loads = await db.getLoads(undefined, room.id);
		const receptacles = await db.getReceptacles(undefined, room.id);

		// Collect unique circuits serving this room
		const circuitIds = new Set<number>();
		for (const l of loads) if (l.circuitId) circuitIds.add(l.circuitId);
		for (const r of receptacles) if (r.circuitId) circuitIds.add(r.circuitId);

		const circuits = [];
		for (const cId of circuitIds) {
			const c = await db.getCircuit(cId);
			if (c) circuits.push({ id: c.id, number: c.number, amps: c.amps, panel: c.panelName });
		}

		return {
			success: true,
			data: {
				room: { id: room.id, name: room.name, floor: room.floor, home: room.homeName },
				circuits,
				loads: loads.map(l => ({
					id: l.id, name: l.name, type: l.deviceType,
					wattage: l.wattage, fixtureCount: l.fixtureCount, circuit: l.circuitNumber
				})),
				receptacles: receptacles.map(r => ({
					id: r.id, name: r.name, type: r.type,
					direction: r.locDirection, placement: r.locPlacement, circuit: r.circuitNumber
				}))
			}
		};
	}
};

export const getPanelDirectory: ToolDefinition = {
	name: 'get_panel_directory',
	description: 'Get the full breaker schedule for a panel: all circuits with their loads. Use when user asks about a panel or wants a breaker directory.',
	category: 'read',
	parameters: {
		panel_name: { type: 'string', description: 'Panel name (e.g., "Main Panel", "Garage Sub")', required: true }
	},
	async execute(args): Promise<ToolResponse> {
		const home = getHomeContext(args);
		// Scope panel search to active home
		const panels = await db.getPanels(home?.homeId);
		const panel = panels.find(p => p.name.toLowerCase() === String(args.panel_name).toLowerCase());
		if (!panel) {
			return { success: false, error: `No panel "${args.panel_name}" found${home ? ` in ${home.homeName}` : ''}. Available: ${panels.map(p => p.name).join(', ')}` };
		}

		const circuits = await db.getCircuits(panel.id);
		const directory = [];

		for (const c of circuits.sort((a, b) => a.number - b.number)) {
			const loads = await db.getLoads(c.id);
			const receptacles = await db.getReceptacles(c.id);
			directory.push({
				number: c.number,
				amps: c.amps,
				description: c.description,
				gfci: c.gfciProtected,
				room: c.roomName,
				loads: loads.map(l => l.name),
				receptacles: receptacles.map(r => `${r.name} (${r.type || 'outlet'})`),
				totalDevices: loads.length + receptacles.length
			});
		}

		return {
			success: true,
			data: {
				panel: { id: panel.id, name: panel.name, location: panel.location, serviceSize: panel.serviceSize },
				circuits: directory,
				totalCircuits: circuits.length
			}
		};
	}
};

export const findDevice: ToolDefinition = {
	name: 'find_device',
	description: 'Find loads or receptacles by description. Uses fuzzy matching. Use when user asks "where is the..." or "find the..." or describes a device.',
	category: 'read',
	parameters: {
		description: { type: 'string', description: 'What to search for (e.g., "kitchen lights", "garage outlet")', required: true },
		room_name: { type: 'string', description: 'Optional room to narrow search' }
	},
	async execute(args): Promise<ToolResponse> {
		const home = getHomeContext(args);
		const query = String(args.description);
		const roomFilter = args.room_name as string | undefined;

		let roomId: number | undefined;
		if (roomFilter) {
			const room = await db.getRoomByName(roomFilter, home?.homeId);
			roomId = room?.id;
		}

		// If home context but no room filter, get all rooms in this home to filter devices
		let roomIds: number[] | undefined;
		if (home && !roomId) {
			const rooms = await db.getRooms(home.homeId);
			roomIds = rooms.map(r => r.id);
		}

		let loads = await db.getLoads(undefined, roomId);
		let receptacles = await db.getReceptacles(undefined, roomId);

		// Filter to home's rooms if we have home context
		if (roomIds && !roomId) {
			loads = loads.filter(l => l.roomId && roomIds!.includes(l.roomId));
			receptacles = receptacles.filter(r => r.roomId && roomIds!.includes(r.roomId));
		}

		const loadMatches = findBestMatches(query, loads, (l) => l.name, { threshold: 0.2, maxResults: 5 });
		const recMatches = findBestMatches(query, receptacles, (r) => r.name, { threshold: 0.2, maxResults: 5 });

		const results = [
			...loadMatches.map(m => ({
				table: 'Load' as const, id: m.item.id, name: m.label, score: Math.round(m.score * 100),
				type: m.item.deviceType, room: m.item.roomName, circuit: m.item.circuitNumber
			})),
			...recMatches.map(m => ({
				table: 'Receptacle' as const, id: m.item.id, name: m.label, score: Math.round(m.score * 100),
				type: m.item.type, room: m.item.roomName, circuit: m.item.circuitNumber
			}))
		].sort((a, b) => b.score - a.score).slice(0, 8);

		if (results.length === 0) {
			return { success: false, error: `No devices found matching "${query}"${roomFilter ? ` in ${roomFilter}` : ''}` };
		}

		return { success: true, data: { query, results } };
	}
};

export const searchElectrical: ToolDefinition = {
	name: 'search_electrical',
	description: 'Free-text search across all tables (homes, rooms, panels, circuits, loads, receptacles). Use for general lookups.',
	category: 'read',
	parameters: {
		query: { type: 'string', description: 'Search term', required: true }
	},
	async execute(args): Promise<ToolResponse> {
		const results = await db.searchAll(String(args.query));
		if (results.length === 0) {
			return { success: false, error: `No results for "${args.query}"` };
		}
		return {
			success: true,
			data: {
				query: args.query,
				results: results.slice(0, 20).map(r => ({
					table: r.table, id: r.id, name: r.name,
					fields: r.fields
				}))
			}
		};
	}
};

export const getCircuitCapacity: ToolDefinition = {
	name: 'get_circuit_capacity',
	description: 'Analyze amperage/capacity for a circuit. Shows rated vs estimated draw and headroom. Use when user asks about capacity or "can I add X to circuit Y?"',
	category: 'read',
	parameters: {
		circuit_number: { type: 'number', description: 'Circuit number', required: true },
		panel_name: { type: 'string', description: 'Panel name (optional)' }
	},
	async execute(args): Promise<ToolResponse> {
		const home = getHomeContext(args);
		const panelName = args.panel_name as string | undefined;

		let circuit;
		if (home && !panelName) {
			const panels = await db.getPanels(home.homeId);
			const matches = [];
			for (const panel of panels) {
				const circuits = await db.getCircuits(panel.id);
				const match = circuits.find(c => c.number === Number(args.circuit_number));
				if (match) matches.push({ circuit: match, panelName: panel.name });
			}
			if (matches.length === 0) {
				return { success: false, error: `Circuit #${args.circuit_number} not found in ${home.homeName}` };
			}
			if (matches.length > 1) {
				return { success: false, error: `Circuit #${args.circuit_number} exists in multiple panels: ${matches.map(m => m.panelName).join(', ')}. Which panel?` };
			}
			circuit = matches[0].circuit;
		} else {
			circuit = await db.getCircuitByNumber(Number(args.circuit_number), panelName);
		}

		if (!circuit) {
			return { success: false, error: `Circuit #${args.circuit_number} not found` };
		}

		const loads = await db.getLoads(circuit.id);
		const totalWatts = loads.reduce((sum, l) => sum + (l.wattage || 0), 0);
		const voltage = 120; // Default; could enhance with circuit.voltage
		const ratedWatts = circuit.amps * voltage;
		const continuousLimit = ratedWatts * 0.8; // NEC 80% rule

		return {
			success: true,
			data: {
				circuit: { number: circuit.number, amps: circuit.amps, panel: circuit.panelName },
				analysis: {
					ratedWatts,
					continuousLimitWatts: continuousLimit,
					estimatedDrawWatts: totalWatts,
					utilizationPercent: Math.round((totalWatts / ratedWatts) * 100),
					continuousUtilizationPercent: Math.round((totalWatts / continuousLimit) * 100),
					headroomWatts: ratedWatts - totalWatts,
					continuousHeadroomWatts: continuousLimit - totalWatts,
					safeToAddWatts: continuousLimit - totalWatts
				},
				loads: loads.map(l => ({ name: l.name, wattage: l.wattage || 0, type: l.deviceType }))
			}
		};
	}
};

/** All read tools */
export const readTools: ToolDefinition[] = [
	whatIsOnCircuit,
	getRoomSummary,
	getPanelDirectory,
	findDevice,
	searchElectrical,
	getCircuitCapacity
];
