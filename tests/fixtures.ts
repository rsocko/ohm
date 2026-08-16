/**
 * Synthetic fixtures shaped like NocoDB electrical topology records (Willow House subset).
 * Used by mcp-tools.test.ts for deterministic testing. All names, addresses, and IDs
 * are fictional and do not correspond to any real property or NocoDB instance.
 */

export const fixtures = {
	homes: [
		{ id: 1, name: 'Willow House', address: '12 Example Ln.', city: 'Rivertown', state: 'MA', zip: '01000' },
		{ id: 2, name: 'Birchwood House', address: '48 Sample Ave', city: 'Lakeview', state: 'MA', zip: '02000' },
	],

	rooms: [
		{ id: 1, name: 'Basement Sitting Area', floor: 'Basement', description: '', homeId: 1, homeName: 'Willow House' },
		{ id: 5, name: 'Kitchen', floor: 'Main', description: '', homeId: 1, homeName: 'Willow House' },
		{ id: 7, name: 'Master Bedroom', floor: 'Main', description: '', homeId: 1, homeName: 'Willow House' },
		{ id: 24, name: 'Family Room', floor: 'Main', description: '', homeId: 1, homeName: 'Willow House' },
		{ id: 26, name: 'Family Room', floor: '1st Floor', description: '', homeId: 2, homeName: 'Birchwood House' },
		{ id: 28, name: 'Kitchen', floor: '1st Floor', description: '', homeId: 2, homeName: 'Birchwood House' },
	],

	panels: [
		{ id: 4, name: 'Main Panel', location: 'Basement', serviceSize: 200, phases: 1, homeId: 1, homeName: 'Willow House' },
		{ id: 5, name: 'Main Panel', location: 'Basement', serviceSize: 200, phases: 1, homeId: 2, homeName: 'Birchwood House' },
	],

	circuits: [
		{ id: 1, number: 13, amps: 15, description: 'Living Room Plugs', gfciProtected: false, panelId: 4, panelName: 'Main Panel', roomId: 24, roomName: 'Family Room' },
		{ id: 2, number: 1, amps: 20, description: 'Counter Plugs', gfciProtected: false, panelId: 4, panelName: 'Main Panel', roomId: 5, roomName: 'Kitchen' },
		{ id: 3, number: 11, amps: 15, description: 'Living Room Lights', gfciProtected: false, panelId: 4, panelName: 'Main Panel', roomId: 24, roomName: 'Family Room' },
		{ id: 5, number: 3, amps: 20, description: '1st Floor Bathroom Plug', gfciProtected: true, panelId: 4, panelName: 'Main Panel', roomId: undefined, roomName: undefined },
		{ id: 6, number: 28, amps: 30, description: 'Air Conditioner', gfciProtected: false, panelId: 4, panelName: 'Main Panel', roomId: undefined, roomName: undefined },
		{ id: 11, number: 7, amps: 20, description: 'Kitchen Recessed Lights, Living Room', gfciProtected: false, panelId: 4, panelName: 'Main Panel', roomId: 5, roomName: 'Kitchen' },
	],

	loads: [
		{ id: 22, name: 'Kitchen - Phone / Wires by island', deviceType: 'Electronics', wattage: undefined, fixtureCount: undefined, roomId: 5, roomName: 'Kitchen', circuitId: undefined, circuitNumber: undefined },
		{ id: 28, name: 'Kitchen - Mid-Kitchen ceiling that is covered now', deviceType: 'Light - Ceiling', wattage: undefined, fixtureCount: undefined, roomId: 5, roomName: 'Kitchen', circuitId: 11, circuitNumber: 7 },
		{ id: 62, name: 'Kitchen - Ceiling by back door', deviceType: 'Light - Ceiling', wattage: undefined, fixtureCount: undefined, roomId: 5, roomName: 'Kitchen', circuitId: 11, circuitNumber: 7 },
		{ id: 68, name: 'Kitchen - Corner Ceiling (3 lights)', deviceType: 'Light - Ceiling', wattage: undefined, fixtureCount: 3, roomId: 5, roomName: 'Kitchen', circuitId: 11, circuitNumber: 7 },
		{ id: 85, name: 'Kitchen - Ceiling (Above Island - 3 lights)', deviceType: 'Light - Ceiling', wattage: undefined, fixtureCount: 3, roomId: 5, roomName: 'Kitchen', circuitId: 11, circuitNumber: 7 },
		{ id: 1, name: 'Master Bedroom-Thermostat Box', deviceType: 'HVAC', wattage: undefined, fixtureCount: undefined, roomId: 7, roomName: 'Master Bedroom', circuitId: undefined, circuitNumber: undefined },
		{ id: 103, name: 'Patio-Camera/Light above door', deviceType: 'Security Camera', wattage: 15, fixtureCount: 1, roomId: 24, roomName: 'Family Room', circuitId: 1, circuitNumber: 13 },
	],

	receptacles: [
		{ id: 1, name: 'FAM-SW-Right side of Patio Door (4-Gang Left-Middle)', type: 'On/Off Relay', gangPosition: 2, locDirection: 'S - South', locPlacement: 'W - Wall', locRecIndex: 1, roomId: 24, roomName: 'Family Room', circuitId: 11, circuitNumber: 7 },
		{ id: 2, name: 'KIT-SW-Behind Microwave (3-Gang-Left)', type: 'On/Off Switch', gangPosition: undefined, locDirection: 'E - East', locPlacement: undefined, locRecIndex: undefined, roomId: 5, roomName: 'Kitchen', circuitId: undefined, circuitNumber: undefined },
		{ id: 46, name: 'KIT-SW-Entrance of Pantry (Left)', type: 'On/Off Switch', gangPosition: undefined, locDirection: 'S - South', locPlacement: undefined, locRecIndex: undefined, roomId: 5, roomName: 'Kitchen', circuitId: 11, circuitNumber: 7 },
		{ id: 68, name: 'KIT-SW-Over Island (2-Gang-Right)', type: 'Dimmer Switch', gangPosition: undefined, locDirection: 'N - North', locPlacement: undefined, locRecIndex: undefined, roomId: 5, roomName: 'Kitchen', circuitId: 11, circuitNumber: 7 },
		{ id: 73, name: 'KIT-GFCI-Right of Stove (2-Gang-Right)', type: 'GFCI Outlet', gangPosition: undefined, locDirection: 'S - South', locPlacement: undefined, locRecIndex: undefined, roomId: 5, roomName: 'Kitchen', circuitId: undefined, circuitNumber: undefined },
	],
};
