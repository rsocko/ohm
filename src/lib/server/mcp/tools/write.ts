/**
 * Write tools — always return a ConfirmationPayload for user approval.
 * The actual mutation happens when executeConfirmed() is called after user clicks Confirm.
 * All tools respect _homeContext for scoping queries to the active home.
 */

import type { ToolDefinition, ToolResponse, ToolResult, ToolError } from '../types';
import { generateConfirmationId, getHomeContext } from '../types';
import { db } from '$lib/server/db';
import { inferEntityFromDescription, inferDeviceType, inferReceptacleType, resolveDirection } from '$lib/server/db/vocabulary';

export const createRoom: ToolDefinition = {
	name: 'create_room',
	description: 'Create a new room/area and link it to a home. Use when user says "add a room", "create a bedroom", etc.',
	category: 'write',
	parameters: {
		name: { type: 'string', description: 'Room name (e.g., "Jordan\'s Bedroom")', required: true },
		floor: { type: 'string', description: 'Floor (e.g., "1st Floor", "2nd Floor", "Basement")' },
		home_name: { type: 'string', description: 'Which home this room belongs to (defaults to active home)' },
		description: { type: 'string', description: 'Optional description' }
	},
	async execute(args): Promise<ToolResponse> {
		const home = getHomeContext(args);
		const name = String(args.name);
		// Use explicit home_name if provided, otherwise fall back to active home context
		const homeName = args.home_name ? String(args.home_name) : home?.homeName;
		if (!homeName) {
			return { success: false, error: 'No home specified and no active home selected. Please specify which home.' };
		}
		const floor = args.floor as string | undefined;
		const description = args.description as string | undefined;

		// Validate home exists
		const homeRecord = await db.getHomeByName(homeName);
		if (!homeRecord) {
			const homes = await db.getHomes();
			return { success: false, error: `Home "${homeName}" not found. Available: ${homes.map(h => h.name).join(', ')}` };
		}

		// Check if room already exists
		const existing = await db.getRoomByName(name, homeRecord.id);
		if (existing) {
			return { success: false, error: `Room "${name}" already exists in ${homeName}` };
		}

		const operations = [
			{ action: 'create' as const, table: 'Area', label: name, details: { Name: name, Floor: floor || '', Description: description || '' } },
			{ action: 'link' as const, table: 'Area', label: `Link ${name} → ${homeName}`, details: { field: 'Home', target: homeName } }
		];

		return {
			success: true,
			confirmation: {
				id: generateConfirmationId(),
				tool: 'create_room',
				summary: `Create room "${name}" on ${floor || 'unspecified floor'} in ${homeName}`,
				operations,
				execute: { tool: 'create_room', args: { name, floor, home_name: homeName, description }, confirmed: true }
			}
		};
	},
	async executeConfirmed(args): Promise<ToolResult | ToolError> {
		try {
			const room = await db.createRoom({
				name: String(args.name),
				floor: args.floor as string | undefined,
				description: args.description as string | undefined,
				homeName: String(args.home_name)
			});
			return { success: true, data: { message: `✓ Created room "${room.name}" and linked to ${args.home_name}`, room } };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Failed to create room' };
		}
	}
};

export const createDevice: ToolDefinition = {
	name: 'create_device',
	description: 'Smart device creation — automatically determines if this is a Load or Receptacle from the description. Use when user says "add a dimmer", "add recessed lights", "add an outlet", etc. without specifying Load vs Receptacle.',
	category: 'write',
	parameters: {
		description: { type: 'string', description: 'What to add (e.g., "dimmer", "recessed lights", "GFCI outlet")', required: true },
		room_name: { type: 'string', description: 'Which room', required: true },
		circuit_number: { type: 'number', description: 'Circuit number (optional)' },
		panel_name: { type: 'string', description: 'Panel name (optional, for multi-panel)' },
		quantity: { type: 'number', description: 'How many (for fixture count on loads)' },
		wall: { type: 'string', description: 'Wall/direction (e.g., "north wall", "ceiling")' },
		custom_name: { type: 'string', description: 'Override auto-generated name' }
	},
	async execute(args): Promise<ToolResponse> {
		const home = getHomeContext(args);
		const desc = String(args.description);
		const roomName = String(args.room_name);
		const circuitNum = args.circuit_number ? Number(args.circuit_number) : undefined;
		const quantity = args.quantity ? Number(args.quantity) : undefined;
		const wall = args.wall ? resolveDirection(String(args.wall)) : undefined;

		// Disambiguate: is this a Load or a Receptacle?
		const inferred = inferEntityFromDescription(desc);
		if (!inferred) {
			return { success: false, error: `Can't determine if "${desc}" is a Load or Receptacle. Please specify — is this a fixture/appliance (Load) or a switch/outlet (Receptacle)?` };
		}

		// Validate room exists (scoped to active home)
		const room = await db.getRoomByName(roomName, home?.homeId);
		if (!room) {
			const rooms = await db.getRooms(home?.homeId);
			const suggestions = rooms.filter(r => r.name.toLowerCase().includes(roomName.toLowerCase().split(' ')[0]));
			const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.map(r => r.name).join(', ')}?` : '';
			return { success: false, error: `Room "${roomName}" not found${home ? ` in ${home.homeName}` : ''}.${hint}` };
		}

		// Validate circuit if specified
		if (circuitNum) {
			const circuit = await db.getCircuitByNumber(circuitNum, args.panel_name as string | undefined);
			if (!circuit) {
				return { success: false, error: `Circuit #${circuitNum} not found` };
			}
		}

		const autoName = args.custom_name ? String(args.custom_name) : `${roomName} ${inferred.typeValue}`;

		const details: Record<string, unknown> = { Name: autoName };
		const operations = [];

		if (inferred.table === 'Load') {
			details['Device Type'] = inferred.typeValue;
			if (quantity) details['Fixture_Count'] = quantity;
			operations.push(
				{ action: 'create' as const, table: 'Load', label: autoName, details: { ...details } },
				{ action: 'link' as const, table: 'Load', label: `Link to room: ${roomName}`, details: { field: 'Area', target: roomName } }
			);
			if (circuitNum) {
				operations.push({ action: 'link' as const, table: 'Load', label: `Link to circuit #${circuitNum}`, details: { field: 'Circuit', target: `#${circuitNum}` } });
			}
		} else {
			details['Receptacle Type'] = inferred.typeValue;
			if (wall) details['Loc.Direction'] = wall;
			operations.push(
				{ action: 'create' as const, table: 'Receptacle', label: autoName, details: { ...details } },
				{ action: 'link' as const, table: 'Receptacle', label: `Link to room: ${roomName}`, details: { field: 'Area', target: roomName } }
			);
			if (circuitNum) {
				operations.push({ action: 'link' as const, table: 'Receptacle', label: `Link to circuit #${circuitNum}`, details: { field: 'Circuit', target: `#${circuitNum}` } });
			}
		}

		return {
			success: true,
			confirmation: {
				id: generateConfirmationId(),
				tool: 'create_device',
				summary: `Add ${inferred.typeValue} (${inferred.table}) to ${roomName}${circuitNum ? ` on circuit #${circuitNum}` : ''}`,
				operations,
				execute: {
					tool: 'create_device',
					args: { ...args, _resolved: { table: inferred.table, typeValue: inferred.typeValue, autoName } },
					confirmed: true
				}
			}
		};
	},
	async executeConfirmed(args): Promise<ToolResult | ToolError> {
		try {
			const resolved = args._resolved as { table: string; typeValue: string; autoName: string };
			const roomName = String(args.room_name);
			const circuitNum = args.circuit_number ? Number(args.circuit_number) : undefined;
			const quantity = args.quantity ? Number(args.quantity) : undefined;
			const wall = args.wall ? resolveDirection(String(args.wall)) : undefined;

			if (resolved.table === 'Load') {
				const load = await db.createLoad({
					name: resolved.autoName,
					deviceType: resolved.typeValue,
					fixtureCount: quantity,
					roomName,
					circuitNumber: circuitNum,
					panelName: args.panel_name as string | undefined
				});
				return { success: true, data: { message: `✓ Created load "${load.name}" in ${roomName}`, load } };
			} else {
				const receptacle = await db.createReceptacle({
					name: resolved.autoName,
					type: resolved.typeValue,
					locDirection: wall,
					roomName,
					circuitNumber: circuitNum,
					panelName: args.panel_name as string | undefined
				});
				return { success: true, data: { message: `✓ Created receptacle "${receptacle.name}" in ${roomName}`, receptacle } };
			}
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Failed to create device' };
		}
	}
};

export const addLoad: ToolDefinition = {
	name: 'add_load',
	description: 'Explicitly create a Load (light, fan, appliance). Use when you know it\'s a Load, or when create_device needs disambiguation.',
	category: 'write',
	parameters: {
		name: { type: 'string', description: 'Load name', required: true },
		device_type: { type: 'string', description: 'Device type (Light, Fan, Appliance, HVAC, Motor, EV, Safety, Low Voltage)', required: true },
		room_name: { type: 'string', description: 'Room to link to', required: true },
		wattage: { type: 'number', description: 'Estimated wattage' },
		fixture_count: { type: 'number', description: 'Number of fixtures (e.g., 4 recessed cans)' },
		circuit_number: { type: 'number', description: 'Circuit to link to' },
		panel_name: { type: 'string', description: 'Panel (for circuit disambiguation)' }
	},
	async execute(args): Promise<ToolResponse> {
		const name = String(args.name);
		const roomName = String(args.room_name);

		const operations = [
			{ action: 'create' as const, table: 'Load', label: name, details: { Name: name, 'Device Type': args.device_type, Wattage: args.wattage ? Number(args.wattage) : '', Fixture_Count: args.fixture_count ? Number(args.fixture_count) : 1 } },
			{ action: 'link' as const, table: 'Load', label: `Link to ${roomName}`, details: { field: 'Area', target: roomName } }
		];
		if (args.circuit_number) {
			operations.push({ action: 'link' as const, table: 'Load', label: `Link to circuit #${args.circuit_number}`, details: { field: 'Circuit', target: `#${args.circuit_number}` } });
		}

		return {
			success: true,
			confirmation: {
				id: generateConfirmationId(),
				tool: 'add_load',
				summary: `Add ${args.device_type} "${name}" to ${roomName}`,
				operations,
				execute: { tool: 'add_load', args: { ...args }, confirmed: true }
			}
		};
	},
	async executeConfirmed(args): Promise<ToolResult | ToolError> {
		try {
			const load = await db.createLoad({
				name: String(args.name),
				deviceType: String(args.device_type),
				wattage: args.wattage ? Number(args.wattage) : undefined,
				fixtureCount: args.fixture_count ? Number(args.fixture_count) : undefined,
				roomName: String(args.room_name),
				circuitNumber: args.circuit_number ? Number(args.circuit_number) : undefined,
				panelName: args.panel_name as string | undefined
			});
			return { success: true, data: { message: `✓ Created load "${load.name}"`, load } };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Failed to create load' };
		}
	}
};

export const addReceptacle: ToolDefinition = {
	name: 'add_receptacle',
	description: 'Explicitly create a Receptacle (outlet, switch, dimmer). Use when you know it\'s a Receptacle.',
	category: 'write',
	parameters: {
		name: { type: 'string', description: 'Receptacle name', required: true },
		receptacle_type: { type: 'string', description: 'Type (Outlet, GFCI Outlet, Switch, Dimmer Switch, 3-Way Switch, USB Outlet, 240V Outlet)', required: true },
		room_name: { type: 'string', description: 'Room to link to', required: true },
		wall: { type: 'string', description: 'Wall direction (N, S, E, W, Ceiling)' },
		gang_position: { type: 'number', description: 'Position in multi-gang box' },
		circuit_number: { type: 'number', description: 'Circuit to link to' },
		panel_name: { type: 'string', description: 'Panel (for circuit disambiguation)' }
	},
	async execute(args): Promise<ToolResponse> {
		const name = String(args.name);
		const roomName = String(args.room_name);
		const wall = args.wall ? resolveDirection(String(args.wall)) : undefined;

		const operations = [
			{ action: 'create' as const, table: 'Receptacle', label: name, details: { Name: name, 'Receptacle Type': args.receptacle_type, 'Loc.Direction': wall || '' } },
			{ action: 'link' as const, table: 'Receptacle', label: `Link to ${roomName}`, details: { field: 'Area', target: roomName } }
		];
		if (args.circuit_number) {
			operations.push({ action: 'link' as const, table: 'Receptacle', label: `Link to circuit #${args.circuit_number}`, details: { field: 'Circuit', target: `#${args.circuit_number}` } });
		}

		return {
			success: true,
			confirmation: {
				id: generateConfirmationId(),
				tool: 'add_receptacle',
				summary: `Add ${args.receptacle_type} "${name}" to ${roomName}`,
				operations,
				execute: { tool: 'add_receptacle', args: { ...args }, confirmed: true }
			}
		};
	},
	async executeConfirmed(args): Promise<ToolResult | ToolError> {
		try {
			const receptacle = await db.createReceptacle({
				name: String(args.name),
				type: String(args.receptacle_type),
				locDirection: args.wall ? resolveDirection(String(args.wall)) : undefined,
				gangPosition: args.gang_position ? Number(args.gang_position) : undefined,
				roomName: String(args.room_name),
				circuitNumber: args.circuit_number ? Number(args.circuit_number) : undefined,
				panelName: args.panel_name as string | undefined
			});
			return { success: true, data: { message: `✓ Created receptacle "${receptacle.name}"`, receptacle } };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Failed to create receptacle' };
		}
	}
};

export const moveDeviceToCircuit: ToolDefinition = {
	name: 'move_device_to_circuit',
	description: 'Move a load or receptacle to a different circuit. Use when user says "move X to circuit Y" or "that\'s actually on circuit 5".',
	category: 'write',
	parameters: {
		device_name: { type: 'string', description: 'Name of the load or receptacle to move', required: true },
		circuit_number: { type: 'number', description: 'Target circuit number', required: true },
		panel_name: { type: 'string', description: 'Panel (optional)' }
	},
	async execute(args): Promise<ToolResponse> {
		const home = getHomeContext(args);
		const deviceName = String(args.device_name);
		const circuitNum = Number(args.circuit_number);

		// Find the device (search both loads and receptacles), scoped to active home
		let loads, receptacles;
		if (home) {
			const rooms = await db.getRooms(home.homeId);
			const roomIds = rooms.map(r => r.id);
			const allLoads = await db.getLoads();
			const allRecs = await db.getReceptacles();
			loads = allLoads.filter(l => l.roomId && roomIds.includes(l.roomId));
			receptacles = allRecs.filter(r => r.roomId && roomIds.includes(r.roomId));
		} else {
			loads = await db.getLoads();
			receptacles = await db.getReceptacles();
		}

		const loadMatch = loads.find(l => l.name.toLowerCase() === deviceName.toLowerCase());
		const recMatch = receptacles.find(r => r.name.toLowerCase() === deviceName.toLowerCase());
		const device = loadMatch || recMatch;
		const deviceTable = loadMatch ? 'Load' : 'Receptacle';

		if (!device) {
			// Try fuzzy match for helpful error
			const allDevices = [...loads.map(l => l.name), ...receptacles.map(r => r.name)];
			const suggestions = allDevices.filter(n => n.toLowerCase().includes(deviceName.toLowerCase().split(' ')[0])).slice(0, 3);
			const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
			return { success: false, error: `Device "${deviceName}" not found${home ? ` in ${home.homeName}` : ''}.${hint}` };
		}

		const circuit = await db.getCircuitByNumber(circuitNum, args.panel_name as string | undefined);
		if (!circuit) {
			return { success: false, error: `Circuit #${circuitNum} not found` };
		}

		return {
			success: true,
			confirmation: {
				id: generateConfirmationId(),
				tool: 'move_device_to_circuit',
				summary: `Move "${device.name}" to circuit #${circuitNum}`,
				operations: [
					{ action: 'link' as const, table: deviceTable, label: `${device.name} → Circuit #${circuitNum}`, details: { from: `Circuit #${(device as any).circuitNumber || 'none'}`, to: `Circuit #${circuitNum}` } }
				],
				execute: { tool: 'move_device_to_circuit', args: { ...args, _resolved: { deviceId: device.id, deviceTable, circuitId: circuit.id } }, confirmed: true }
			}
		};
	},
	async executeConfirmed(args): Promise<ToolResult | ToolError> {
		try {
			const resolved = args._resolved as { deviceId: number; deviceTable: string; circuitId: number };
			if (resolved.deviceTable === 'Load') {
				await db.linkLoadToCircuit(resolved.deviceId, resolved.circuitId);
			} else {
				await db.linkReceptacleToCircuit(resolved.deviceId, resolved.circuitId);
			}
			return { success: true, data: { message: `✓ Moved device to circuit #${args.circuit_number}` } };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Failed to move device' };
		}
	}
};

export const updateField: ToolDefinition = {
	name: 'update_field',
	description: 'Update a specific field on any record. Use for renaming, changing descriptions, etc.',
	category: 'write',
	parameters: {
		table: { type: 'string', description: 'Table name (Home, Area, Panel, Circuit, Load, Receptacle)', required: true, enum: ['Home', 'Area', 'Panel', 'Circuit', 'Load', 'Receptacle'] },
		record_name: { type: 'string', description: 'Name of the record to update', required: true },
		field: { type: 'string', description: 'Field to change', required: true },
		new_value: { type: 'string', description: 'New value', required: true }
	},
	async execute(args): Promise<ToolResponse> {
		const tableName = String(args.table);
		const recordName = String(args.record_name);
		const field = String(args.field);
		const newValue = String(args.new_value);

		// Find the record by name
		const records = await db.getRawRecords(tableName, { pageSize: '200' });
		const record = records.find(r =>
			String(r.fields['Name'] || r.fields['Number'] || '').toLowerCase() === recordName.toLowerCase()
		);
		if (!record) {
			return { success: false, error: `No "${recordName}" found in ${tableName} table` };
		}

		const oldValue = String(record.fields[field] || '');

		return {
			success: true,
			confirmation: {
				id: generateConfirmationId(),
				tool: 'update_field',
				summary: `Update ${tableName} "${recordName}" — ${field}: "${oldValue}" → "${newValue}"`,
				operations: [
					{ action: 'update' as const, table: tableName, label: recordName, details: { field, oldValue, newValue } }
				],
				execute: { tool: 'update_field', args: { ...args, _resolved: { recordId: record.id } }, confirmed: true }
			}
		};
	},
	async executeConfirmed(args): Promise<ToolResult | ToolError> {
		try {
			const resolved = args._resolved as { recordId: number };
			await db.updateRawRecord(String(args.table), resolved.recordId, { [String(args.field)]: args.new_value });
			return { success: true, data: { message: `✓ Updated ${args.field} to "${args.new_value}"` } };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Failed to update' };
		}
	}
};

export const linkToRoom: ToolDefinition = {
	name: 'link_to_room',
	description: 'Link an existing load or receptacle to a room. Use when user says "that outlet is in the kitchen" or "move the fan to the bedroom".',
	category: 'write',
	parameters: {
		device_name: { type: 'string', description: 'Name of the load or receptacle to link', required: true },
		room_name: { type: 'string', description: 'Target room name', required: true }
	},
	async execute(args): Promise<ToolResponse> {
		const home = getHomeContext(args);
		const deviceName = String(args.device_name);
		const roomName = String(args.room_name);

		// Find the device (search both loads and receptacles), scoped to active home
		let loads, receptacles;
		if (home) {
			const rooms = await db.getRooms(home.homeId);
			const roomIds = rooms.map(r => r.id);
			const allLoads = await db.getLoads();
			const allRecs = await db.getReceptacles();
			loads = allLoads.filter(l => !l.roomId || roomIds.includes(l.roomId));
			receptacles = allRecs.filter(r => !r.roomId || roomIds.includes(r.roomId));
		} else {
			loads = await db.getLoads();
			receptacles = await db.getReceptacles();
		}

		const loadMatch = loads.find(l => l.name.toLowerCase() === deviceName.toLowerCase());
		const recMatch = receptacles.find(r => r.name.toLowerCase() === deviceName.toLowerCase());
		const device = loadMatch || recMatch;
		const deviceTable = loadMatch ? 'Load' : 'Receptacle';

		if (!device) {
			const allDevices = [...loads.map(l => l.name), ...receptacles.map(r => r.name)];
			const suggestions = allDevices.filter(n => n.toLowerCase().includes(deviceName.toLowerCase().split(' ')[0])).slice(0, 3);
			const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
			return { success: false, error: `Device "${deviceName}" not found${home ? ` in ${home.homeName}` : ''}.${hint}` };
		}

		// Validate target room exists
		const room = await db.getRoomByName(roomName, home?.homeId);
		if (!room) {
			const rooms = await db.getRooms(home?.homeId);
			const suggestions = rooms.filter(r => r.name.toLowerCase().includes(roomName.toLowerCase().split(' ')[0])).slice(0, 3);
			const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.map(r => r.name).join(', ')}?` : '';
			return { success: false, error: `Room "${roomName}" not found${home ? ` in ${home.homeName}` : ''}.${hint}` };
		}

		const currentRoom = device.roomId
			? (await db.getRoom(device.roomId))?.name || 'unknown'
			: 'none';

		return {
			success: true,
			confirmation: {
				id: generateConfirmationId(),
				tool: 'link_to_room',
				summary: `Link "${device.name}" to ${roomName}`,
				operations: [
					{ action: 'link' as const, table: deviceTable, label: `${device.name} → ${roomName}`, details: { from: currentRoom, to: roomName } }
				],
				execute: { tool: 'link_to_room', args: { ...args, _resolved: { deviceId: device.id, deviceTable, roomId: room.id } }, confirmed: true }
			}
		};
	},
	async executeConfirmed(args): Promise<ToolResult | ToolError> {
		try {
			const resolved = args._resolved as { deviceId: number; deviceTable: string; roomId: number };
			await db.replaceLinks(resolved.deviceTable, 'Area', resolved.deviceId, [resolved.roomId]);
			return { success: true, data: { message: `✓ Linked device to ${args.room_name}` } };
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : 'Failed to link device to room' };
		}
	}
};

/** All write tools */
export const writeTools: ToolDefinition[] = [
	createRoom,
	createDevice,
	addLoad,
	addReceptacle,
	moveDeviceToCircuit,
	linkToRoom,
	updateField
];
