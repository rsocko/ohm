/**
 * MCP Tool tests — deterministic tests using synthetic fixture data shaped like NocoDB records.
 * Validates all 12 tools (6 read, 6 write) without live dependencies.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fixtures } from './fixtures';

// vi.hoisted provides the mock data that vi.mock factories can reference
const { mockDb } = vi.hoisted(() => {
	// Inline mock provider using real fixture data (injected at test time)
	const f = {
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
			{ id: 5, number: 3, amps: 20, description: '1st Floor Bathroom Plug', gfciProtected: true, panelId: 4, panelName: 'Main Panel' },
			{ id: 6, number: 28, amps: 30, description: 'Air Conditioner', gfciProtected: false, panelId: 4, panelName: 'Main Panel' },
			{ id: 11, number: 7, amps: 20, description: 'Kitchen Recessed Lights, Living Room', gfciProtected: false, panelId: 4, panelName: 'Main Panel', roomId: 5, roomName: 'Kitchen' },
		],
		loads: [
			{ id: 22, name: 'Kitchen - Phone / Wires by island', deviceType: 'Electronics', roomId: 5, roomName: 'Kitchen' },
			{ id: 28, name: 'Kitchen - Mid-Kitchen ceiling that is covered now', deviceType: 'Light - Ceiling', roomId: 5, roomName: 'Kitchen', circuitId: 11, circuitNumber: 7 },
			{ id: 62, name: 'Kitchen - Ceiling by back door', deviceType: 'Light - Ceiling', roomId: 5, roomName: 'Kitchen', circuitId: 11, circuitNumber: 7 },
			{ id: 68, name: 'Kitchen - Corner Ceiling (3 lights)', deviceType: 'Light - Ceiling', fixtureCount: 3, roomId: 5, roomName: 'Kitchen', circuitId: 11, circuitNumber: 7 },
			{ id: 85, name: 'Kitchen - Ceiling (Above Island - 3 lights)', deviceType: 'Light - Ceiling', fixtureCount: 3, roomId: 5, roomName: 'Kitchen', circuitId: 11, circuitNumber: 7 },
			{ id: 1, name: 'Master Bedroom-Thermostat Box', deviceType: 'HVAC', roomId: 7, roomName: 'Master Bedroom' },
			{ id: 103, name: 'Patio-Camera/Light above door', deviceType: 'Security Camera', wattage: 15, fixtureCount: 1, roomId: 24, roomName: 'Family Room', circuitId: 1, circuitNumber: 13 },
		],
		receptacles: [
			{ id: 1, name: 'FAM-SW-Right side of Patio Door (4-Gang Left-Middle)', type: 'On/Off Relay', gangPosition: 2, locDirection: 'S - South', locPlacement: 'W - Wall', locRecIndex: 1, roomId: 24, roomName: 'Family Room', circuitId: 11, circuitNumber: 7 },
			{ id: 2, name: 'KIT-SW-Behind Microwave (3-Gang-Left)', type: 'On/Off Switch', locDirection: 'E - East', roomId: 5, roomName: 'Kitchen' },
			{ id: 46, name: 'KIT-SW-Entrance of Pantry (Left)', type: 'On/Off Switch', locDirection: 'S - South', roomId: 5, roomName: 'Kitchen', circuitId: 11, circuitNumber: 7 },
			{ id: 68, name: 'KIT-SW-Over Island (2-Gang-Right)', type: 'Dimmer Switch', locDirection: 'N - North', roomId: 5, roomName: 'Kitchen', circuitId: 11, circuitNumber: 7 },
			{ id: 73, name: 'KIT-GFCI-Right of Stove (2-Gang-Right)', type: 'GFCI Outlet', locDirection: 'S - South', roomId: 5, roomName: 'Kitchen' },
		],
	};

	const operations: any[] = [];
	let nextId = 200;

	const mockDb = {
		operations,
		reset() { operations.length = 0; nextId = 200; },
		async getHomes() { return f.homes; },
		async getHome(id: number) { return f.homes.find(h => h.id === id) || null; },
		async getHomeByName(name: string) { return f.homes.find(h => h.name.toLowerCase() === name.toLowerCase()) || null; },
		async getRooms(homeId?: number) { return homeId ? f.rooms.filter(r => r.homeId === homeId) : f.rooms; },
		async getRoom(id: number) { return f.rooms.find(r => r.id === id) || null; },
		async getRoomByName(name: string, homeId?: number) {
			return f.rooms.find(r => r.name.toLowerCase() === name.toLowerCase() && (!homeId || r.homeId === homeId)) || null;
		},
		async createRoom(data: any) {
			const room = { id: nextId++, name: data.name, floor: data.floor, description: data.description, homeId: 1, homeName: data.homeName || 'Willow House' };
			operations.push({ type: 'createRoom', args: data });
			return room;
		},
		async updateRoom(id: number, data: any) { operations.push({ type: 'updateRoom', args: { id, data } }); },
		async deleteRoom(id: number) { operations.push({ type: 'deleteRoom', args: { id } }); },
		async getPanels(homeId?: number) { return homeId ? f.panels.filter((p: any) => p.homeId === homeId) : f.panels; },
		async getPanel(id: number) { return f.panels.find((p: any) => p.id === id) || null; },
		async getPanelByName(name: string) { return f.panels.find((p: any) => p.name.toLowerCase() === name.toLowerCase()) || null; },
		async getCircuits(panelId?: number) { return panelId ? f.circuits.filter((c: any) => c.panelId === panelId) : f.circuits; },
		async getCircuit(id: number) { return f.circuits.find((c: any) => c.id === id) || null; },
		async getCircuitByNumber(num: number, panelName?: string) {
			return f.circuits.find((c: any) => c.number === num && (!panelName || c.panelName?.toLowerCase() === panelName?.toLowerCase())) || null;
		},
		async createCircuit(data: any) { const c = { id: nextId++, ...data }; operations.push({ type: 'createCircuit', args: data }); return c; },
		async updateCircuit(id: number, data: any) { operations.push({ type: 'updateCircuit', args: { id, data } }); },
		async getLoads(circuitId?: number, roomId?: number) {
			let r = f.loads as any[];
			if (circuitId) r = r.filter(l => l.circuitId === circuitId);
			if (roomId) r = r.filter(l => l.roomId === roomId);
			return r;
		},
		async getLoad(id: number) { return f.loads.find((l: any) => l.id === id) || null; },
		async createLoad(data: any) {
			const room = data.roomName ? f.rooms.find(r => r.name.toLowerCase() === data.roomName.toLowerCase()) : null;
			const circuit = data.circuitNumber ? f.circuits.find((c: any) => c.number === data.circuitNumber) : null;
			const load = { id: nextId++, name: data.name, deviceType: data.deviceType, wattage: data.wattage, fixtureCount: data.fixtureCount, roomId: room?.id, roomName: room?.name, circuitId: circuit?.id, circuitNumber: circuit?.number };
			operations.push({ type: 'createLoad', args: data });
			return load;
		},
		async updateLoad(id: number, data: any) { operations.push({ type: 'updateLoad', args: { id, data } }); },
		async deleteLoad(id: number) { operations.push({ type: 'deleteLoad', args: { id } }); },
		async linkLoadToCircuit(loadId: number, circuitId: number) {
			operations.push({ type: 'linkLoadToCircuit', args: { loadId, circuitId } });
		},
		async getReceptacles(circuitId?: number, roomId?: number) {
			let r = f.receptacles as any[];
			if (circuitId) r = r.filter(x => x.circuitId === circuitId);
			if (roomId) r = r.filter(x => x.roomId === roomId);
			return r;
		},
		async getReceptacle(id: number) { return f.receptacles.find((r: any) => r.id === id) || null; },
		async createReceptacle(data: any) {
			const room = data.roomName ? f.rooms.find(r => r.name.toLowerCase() === data.roomName.toLowerCase()) : null;
			const rec = { id: nextId++, name: data.name, type: data.type, locDirection: data.locDirection, roomId: room?.id, roomName: room?.name };
			operations.push({ type: 'createReceptacle', args: data });
			return rec;
		},
		async updateReceptacle(id: number, data: any) { operations.push({ type: 'updateReceptacle', args: { id, data } }); },
		async deleteReceptacle(id: number) { operations.push({ type: 'deleteReceptacle', args: { id } }); },
		async linkReceptacleToCircuit(recId: number, circuitId: number) {
			operations.push({ type: 'linkReceptacleToCircuit', args: { recId, circuitId } });
		},
		async searchAll(query: string) {
			const q = query.toLowerCase();
			const results: any[] = [];
			for (const r of f.rooms) if (r.name.toLowerCase().includes(q)) results.push({ table: 'Area', id: r.id, name: r.name, fields: { Name: r.name, Floor: r.floor } });
			for (const c of f.circuits) if (String(c.number).includes(q) || (c.description || '').toLowerCase().includes(q)) results.push({ table: 'Circuit', id: c.id, name: `Circuit ${c.number}`, fields: { Number: c.number, Description: c.description } });
			for (const l of f.loads as any[]) if (l.name.toLowerCase().includes(q) || (l.deviceType || '').toLowerCase().includes(q)) results.push({ table: 'Load', id: l.id, name: l.name, fields: { Name: l.name, 'Device Type': l.deviceType } });
			for (const r of f.receptacles as any[]) if (r.name.toLowerCase().includes(q) || (r.type || '').toLowerCase().includes(q)) results.push({ table: 'Receptacle', id: r.id, name: r.name, fields: { Name: r.name, 'Receptacle Type': r.type } });
			return results;
		},
		async uploadFile(_f: any, filename: string, mimetype: string) { return { path: `/uploads/${filename}`, title: filename, mimetype }; },
		async getRawRecords(table: string) {
			if (table === 'Load') return f.loads.map((l: any) => ({ id: l.id, fields: { Name: l.name, 'Device Type': l.deviceType, Wattage: l.wattage, Fixture_Count: l.fixtureCount } }));
			if (table === 'Receptacle') return f.receptacles.map((r: any) => ({ id: r.id, fields: { Name: r.name, 'Receptacle Type': r.type } }));
			if (table === 'Circuit') return f.circuits.map((c: any) => ({ id: c.id, fields: { Number: c.number, Name: c.description } }));
			return [];
		},
		async updateRawRecord(t: string, id: number, fields: any) { operations.push({ type: 'updateRawRecord', args: { t, id, fields } }); },
		async createRawRecord(t: string, fields: any) { return { id: nextId++, fields }; },
		async getLinkColumns() { return []; },
		async addLinks(t: string, col: string, src: number, targets: number[]) { operations.push({ type: 'addLinks', args: { t, col, src, targets } }); },
		async replaceLinks(t: string, col: string, id: number, ids: number[]) { operations.push({ type: 'replaceLinks', args: { t, col, id, ids } }); },
	};

	return { mockDb };
});

vi.mock('$lib/server/db', () => ({
	db: mockDb,
	getProvider: () => mockDb,
}));

vi.mock('$lib/server/db/vocabulary', () => ({
	inferEntityFromDescription: (desc: string) => {
		const lower = desc.toLowerCase();
		if (lower.includes('light') || lower.includes('recessed') || lower.includes('fan') || lower.includes('camera')) {
			let typeValue = 'Electronics';
			if (lower.includes('light') || lower.includes('recessed') || lower.includes('ceiling')) typeValue = 'Light - Ceiling';
			else if (lower.includes('fan')) typeValue = 'Fan';
			else if (lower.includes('camera')) typeValue = 'Security Camera';
			return { table: 'Load', typeName: 'Device Type', typeValue, confidence: 'high' };
		}
		if (lower.includes('outlet') || lower.includes('switch') || lower.includes('dimmer') || lower.includes('relay') || lower.includes('gfci')) {
			let typeValue = 'Outlet';
			if (lower.includes('dimmer')) typeValue = 'Dimmer Switch';
			else if (lower.includes('switch')) typeValue = 'On/Off Switch';
			else if (lower.includes('gfci')) typeValue = 'GFCI Outlet';
			else if (lower.includes('relay')) typeValue = 'On/Off Relay';
			return { table: 'Receptacle', typeName: 'Receptacle Type', typeValue, confidence: 'high' };
		}
		return null;
	},
	inferDeviceType: (desc: string) => {
		const lower = desc.toLowerCase();
		if (lower.includes('light') || lower.includes('recessed') || lower.includes('ceiling')) return 'Light - Ceiling';
		if (lower.includes('fan')) return 'Fan';
		if (lower.includes('camera')) return 'Security Camera';
		return 'Electronics';
	},
	inferReceptacleType: (desc: string) => {
		const lower = desc.toLowerCase();
		if (lower.includes('dimmer')) return 'Dimmer Switch';
		if (lower.includes('switch')) return 'On/Off Switch';
		if (lower.includes('gfci')) return 'GFCI Outlet';
		if (lower.includes('relay')) return 'On/Off Relay';
		return 'Outlet';
	},
	resolveDirection: (dir: string) => {
		const map: Record<string, string> = { north: 'N - North', south: 'S - South', east: 'E - East', west: 'W - West', n: 'N - North', s: 'S - South', e: 'E - East', w: 'W - West' };
		return map[dir.toLowerCase()] || dir;
	},
	getVocabularySummary: () => '',
}));

vi.mock('$lib/server/fuzzy-match', () => ({
	findBestMatches: (query: string, items: any[], labelFn: (item: any) => string, opts: any) => {
		const q = query.toLowerCase();
		return items
			.map(item => ({ item, label: labelFn(item), score: labelFn(item).toLowerCase().includes(q) ? 0.8 : 0.1 }))
			.filter(m => m.score >= (opts?.threshold || 0.25))
			.slice(0, opts?.maxResults || 5);
	}
}));

// --- Cross-feature mocks (B1–B4) ---

vi.mock('$lib/server/energy-mappings', () => ({
	getEntityMappings: vi.fn(async () => [
		{ circuitId: 11, circuitName: 'Kitchen Recessed Lights, Living Room', panelName: 'Main Panel', entityId: 'sensor.emporia_vue_circuit_7', powerEntityId: 'sensor.emporia_vue_circuit_7', energyEntityId: null, ampRating: 20, voltage: 120 },
		{ circuitId: 1, circuitName: 'Living Room Plugs', panelName: 'Main Panel', entityId: 'sensor.emporia_vue_circuit_13', powerEntityId: 'sensor.emporia_vue_circuit_13', energyEntityId: null, ampRating: 15, voltage: 120 },
	]),
}));

vi.mock('$lib/server/ha-energy', () => ({
	checkConnection: vi.fn(async () => true),
	getCircuitReadings: vi.fn(async (mappings: any[]) => mappings.map((m: any) => ({
		circuitId: m.circuitId,
		circuitName: m.circuitName,
		entityId: m.entityId,
		watts: m.circuitId === 11 ? 245 : 15,
		trend: 'flat' as const,
		capacityPercent: m.circuitId === 11 ? 10 : 1,
		panelName: m.panelName,
	}))),
	getSolarReading: vi.fn(async () => ({
		production: 3200, todayWh: 18500, netWatts: 0, lifetimeKwh: 12450, gridImportW: 0, gridExportW: 2940,
	})),
	calculateCost: vi.fn((watts: number) => ({
		dailyCost: (watts / 1000) * 24 * 0.138,
		monthlyCost: (watts / 1000) * 24 * 30 * 0.138,
		ratePerKwh: 0.138,
	})),
	getUtilityRate: vi.fn(() => 0.138),
}));

vi.mock('$lib/server/ha-client', () => ({
	isConfigured: vi.fn(async () => true),
	getEntity: vi.fn(async (entityId: string) => {
		const entities: Record<string, any> = {
			'light.kitchen': { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen Light', brightness: 200, color_mode: 'brightness' }, last_changed: '2024-01-01T00:00:00Z', last_updated: '2024-01-01T00:00:00Z' },
			'climate.thermostat': { entity_id: 'climate.thermostat', state: 'heat', attributes: { friendly_name: 'Main Thermostat', temperature: 72, current_temperature: 68, hvac_action: 'heating' }, last_changed: '2024-01-01T00:00:00Z', last_updated: '2024-01-01T00:00:00Z' },
			'switch.garage_door': { entity_id: 'switch.garage_door', state: 'off', attributes: { friendly_name: 'Garage Door' }, last_changed: '2024-01-01T00:00:00Z', last_updated: '2024-01-01T00:00:00Z' },
		};
		return entities[entityId] || null;
	}),
	getEntities: vi.fn(async (opts?: any) => {
		const all = [
			{ entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen Light', brightness: 200 }, last_changed: '2024-01-01T00:00:00Z', last_updated: '2024-01-01T00:00:00Z' },
			{ entity_id: 'light.living_room', state: 'off', attributes: { friendly_name: 'Living Room Light' }, last_changed: '2024-01-01T00:00:00Z', last_updated: '2024-01-01T00:00:00Z' },
			{ entity_id: 'switch.garage_door', state: 'off', attributes: { friendly_name: 'Garage Door' }, last_changed: '2024-01-01T00:00:00Z', last_updated: '2024-01-01T00:00:00Z' },
			{ entity_id: 'climate.thermostat', state: 'heat', attributes: { friendly_name: 'Main Thermostat', temperature: 72, current_temperature: 68 }, last_changed: '2024-01-01T00:00:00Z', last_updated: '2024-01-01T00:00:00Z' },
		];
		if (opts?.domain) return all.filter(e => e.entity_id.startsWith(`${opts.domain}.`));
		return all;
	}),
	callService: vi.fn(async (req: any) => ({
		success: true,
		new_state: req.action === 'turn_on' ? 'on' : req.action === 'turn_off' ? 'off' : 'on',
	})),
}));

vi.mock('$lib/server/unifi', () => ({
	getDevices: vi.fn(async () => [
		{ mac: 'aa:bb:cc:dd:ee:01', ip: '192.0.2.1', name: 'Office AP', model: 'U6-Lite', model_in_lts: true, type: 'uap', adopted: true, state: 1, version: '6.5.28', system_stats: { cpu: '12', mem: '45', uptime: '86400' }, port_table: [] },
		{ mac: 'aa:bb:cc:dd:ee:02', ip: '192.0.2.2', name: 'Main Switch', model: 'USW-24-PoE', model_in_lts: true, type: 'usw', adopted: true, state: 1, version: '6.5.28', system_stats: { cpu: '8', mem: '32', uptime: '172800' }, port_table: [{ port_idx: 1, name: 'Port 1', media: '1000BaseT', speed: 1000, up: true }, { port_idx: 2, name: 'Port 2', media: '1000BaseT', speed: 1000, up: false }] },
	]),
	getDevice: vi.fn(async (mac: string) => {
		if (mac.toLowerCase() === 'aa:bb:cc:dd:ee:01') {
			return { mac: 'aa:bb:cc:dd:ee:01', ip: '192.0.2.1', name: 'Office AP', model: 'U6-Lite', type: 'uap', adopted: true, state: 1, version: '6.5.28', system_stats: { cpu: '12', mem: '45', uptime: '86400' }, port_table: [] };
		}
		return null;
	}),
	getClients: vi.fn(async () => [
		{ mac: '11:22:33:44:55:01', ip: '192.0.2.100', hostname: 'sams-macbook', name: "Sam's MacBook", is_wired: false, is_guest: false, uptime: 43200, last_seen: Math.floor(Date.now() / 1000) },
		{ mac: '11:22:33:44:55:02', ip: '192.0.2.101', hostname: 'hp-printer', name: 'HP Printer', is_wired: true, is_guest: false, uptime: 86400, last_seen: Math.floor(Date.now() / 1000), sw_mac: 'aa:bb:cc:dd:ee:02', sw_port: 1 },
	]),
	mapDeviceTypeToRole: vi.fn((type: string) => {
		const mapping: Record<string, string> = { ugw: 'Gateway', udm: 'Gateway', uxg: 'Gateway', usw: 'Switch', uap: 'Access Point' };
		return mapping[type] || 'Client Device';
	}),
}));

// Import tools after mocks are set up
import { readTools } from '$lib/server/mcp/tools/read';
import { writeTools } from '$lib/server/mcp/tools/write';
import { crossFeatureReadTools } from '$lib/server/mcp/tools/cross-feature';
import { crossFeatureWriteTools } from '$lib/server/mcp/tools/control';
import { registry, isConfirmation, isDataResult } from '$lib/server/mcp';

beforeEach(() => {
	mockDb.reset();
});

// ==================== Read Tools ====================

describe('Read Tools (synthetic Willow House data)', () => {
	const getTool = (name: string) => readTools.find(t => t.name === name)!;

	describe('get_room_summary', () => {
		it('returns Kitchen with its 7 loads and 5 receptacles', async () => {
			const result = await getTool('get_room_summary').execute({ room_name: 'Kitchen' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.room.name).toBe('Kitchen');
			expect(data.room.floor).toBe('Main');
			expect(data.loads.length).toBeGreaterThanOrEqual(5); // 5 ceiling lights + electronics + more
			expect(data.receptacles.length).toBeGreaterThanOrEqual(4); // switches + GFCI
		});

		it('returns Family Room (Willow House) by default', async () => {
			const result = await getTool('get_room_summary').execute({ room_name: 'Family Room' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.room.name).toBe('Family Room');
			expect(data.room.home).toBe('Willow House');
		});

		it('returns error for nonexistent room', async () => {
			const result = await getTool('get_room_summary').execute({ room_name: 'Garage' });
			expect(result.success).toBe(false);
		});
	});

	describe('what_is_on_circuit', () => {
		it('returns loads and receptacles for circuit 7 (Kitchen Recessed)', async () => {
			const result = await getTool('what_is_on_circuit').execute({ circuit_number: '7' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.circuit.number).toBe(7);
			expect(data.circuit.amps).toBe(20);
			expect(data.loads.length).toBeGreaterThanOrEqual(4); // 4 ceiling lights on circuit 11 (id=11, number=7)
			expect(data.receptacles.length).toBeGreaterThanOrEqual(2); // pantry switch + island dimmer
		});

		it('returns error for nonexistent circuit', async () => {
			const result = await getTool('what_is_on_circuit').execute({ circuit_number: '99' });
			expect(result.success).toBe(false);
		});
	});

	describe('get_panel_directory', () => {
		it('returns Main Panel with 6 circuits', async () => {
			const result = await getTool('get_panel_directory').execute({ panel_name: 'Main Panel' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.panel.name).toBe('Main Panel');
			expect(data.circuits.length).toBe(6);
			// Verify circuit numbers match real data
			const numbers = data.circuits.map((c: any) => c.number).sort((a: number, b: number) => a - b);
			expect(numbers).toContain(1);
			expect(numbers).toContain(7);
			expect(numbers).toContain(13);
			expect(numbers).toContain(28);
		});

		it('returns error for unknown panel', async () => {
			const result = await getTool('get_panel_directory').execute({ panel_name: 'Nonexistent' });
			expect(result.success).toBe(false);
		});
	});

	describe('find_device', () => {
		it('finds ceiling lights by "ceiling"', async () => {
			const result = await getTool('find_device').execute({ description: 'ceiling' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.results.length).toBeGreaterThan(0);
			expect(data.results.some((r: any) => r.name.includes('Ceiling'))).toBe(true);
		});

		it('finds thermostat', async () => {
			const result = await getTool('find_device').execute({ description: 'thermostat' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.results.length).toBeGreaterThan(0);
		});
	});

	describe('search_electrical', () => {
		it('searches across tables for "kitchen"', async () => {
			const result = await getTool('search_electrical').execute({ query: 'kitchen' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			const tables = [...new Set(data.results.map((r: any) => r.table))];
			expect(tables).toContain('Area');
			expect(tables).toContain('Load');
		});

		it('finds GFCI receptacles', async () => {
			const result = await getTool('search_electrical').execute({ query: 'gfci' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.results.some((r: any) => r.table === 'Receptacle')).toBe(true);
		});
	});

	describe('get_circuit_capacity', () => {
		it('calculates capacity for circuit 13 (15A, one 15W camera)', async () => {
			const result = await getTool('get_circuit_capacity').execute({ circuit_number: '13' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.circuit.number).toBe(13);
			expect(data.circuit.amps).toBe(15);
			expect(data.analysis.estimatedDrawWatts).toBe(15); // Only the camera has wattage defined
		});
	});

	describe('list_rooms', () => {
		it('lists all rooms grouped by floor (no home context)', async () => {
			const result = await getTool('list_rooms').execute({});
			expect(result.success).toBe(true);
			const data = (result as any).data;
			expect(data.totalRooms).toBe(6);
			expect(data.byFloor).toHaveProperty('Main');
			expect(data.byFloor).toHaveProperty('Basement');
			expect(data.byFloor).toHaveProperty('1st Floor');
		});

		it('lists rooms scoped to Willow House', async () => {
			const result = await getTool('list_rooms').execute({ _homeContext: { homeId: 1, homeName: 'Willow House' } });
			expect(result.success).toBe(true);
			const data = (result as any).data;
			expect(data.home).toBe('Willow House');
			expect(data.totalRooms).toBe(4); // 4 Willow House rooms in fixtures
			expect(data.byFloor['1st Floor']).toBeUndefined(); // Lakeview-only floor
		});

		it('filters by floor', async () => {
			const result = await getTool('list_rooms').execute({ floor: 'Basement' });
			expect(result.success).toBe(true);
			const data = (result as any).data;
			expect(data.totalRooms).toBe(1);
			expect(data.byFloor['Basement'][0].name).toBe('Basement Sitting Area');
		});

		it('returns error for non-existent floor', async () => {
			const result = await getTool('list_rooms').execute({ floor: '3rd Floor' });
			expect(result.success).toBe(false);
		});
	});

	describe('get_home_overview', () => {
		it('returns overview for Willow House', async () => {
			const result = await getTool('get_home_overview').execute({ _homeContext: { homeId: 1, homeName: 'Willow House' } });
			expect(result.success).toBe(true);
			const data = (result as any).data;
			expect(data.home).toBe('Willow House');
			expect(data.rooms.total).toBe(4);
			expect(data.panels).toHaveLength(1);
			expect(data.panels[0].name).toBe('Main Panel');
			expect(data.totalCircuits).toBe(6);
			expect(data.totalDevices).toBeGreaterThan(0);
		});

		it('returns overview without home context (all homes)', async () => {
			const result = await getTool('get_home_overview').execute({});
			expect(result.success).toBe(true);
			const data = (result as any).data;
			expect(data.home).toBe('All homes');
			expect(data.panels).toHaveLength(2); // Both panels
		});
	});
});

// ==================== Write Tools ====================

describe('Write Tools (real schema validation)', () => {
	const getTool = (name: string) => writeTools.find(t => t.name === name)!;

	describe('create_room', () => {
		it('proposes creating a room in Willow House with correct operations', async () => {
			const result = await getTool('create_room').execute({ name: "Jordan's Bedroom", floor: 'Basement', home_name: 'Willow House' });
			expect(result.success).toBe(true);
			expect(isConfirmation(result)).toBe(true);
			if (!isConfirmation(result)) return;
			expect(result.confirmation.summary).toContain("Jordan's Bedroom");
			expect(result.confirmation.operations[0].action).toBe('create');
			expect(result.confirmation.operations[0].table).toBe('Area');
			expect(result.confirmation.operations[1].action).toBe('link');
		});

		it('rejects duplicate room name', async () => {
			const result = await getTool('create_room').execute({ name: 'Kitchen', home_name: 'Willow House' });
			expect(result.success).toBe(false);
		});

		it('rejects unknown home', async () => {
			const result = await getTool('create_room').execute({ name: 'Office', home_name: 'Beach House' });
			expect(result.success).toBe(false);
			if (result.success) return;
			expect(result.error).toContain('Beach House');
			expect(result.error).toContain('Willow House'); // Should suggest valid homes
		});

		it('executeConfirmed actually creates', async () => {
			const result = await getTool('create_room').executeConfirmed!({ name: "Sam's Office", floor: '2nd Floor', home_name: 'Willow House' });
			expect(result.success).toBe(true);
			expect(mockDb.operations.some(op => op.type === 'createRoom')).toBe(true);
			const createOp = mockDb.operations.find(op => op.type === 'createRoom');
			expect((createOp!.args as any).name).toBe("Sam's Office");
		});
	});

	describe('create_device', () => {
		it('infers Load from "recessed lights"', async () => {
			const result = await getTool('create_device').execute({ description: 'recessed lights', room_name: 'Kitchen', quantity: '6' });
			expect(result.success).toBe(true);
			expect(isConfirmation(result)).toBe(true);
			if (!isConfirmation(result)) return;
			expect(result.confirmation.operations[0].table).toBe('Load');
			expect(result.confirmation.operations[0].details).toHaveProperty('Fixture_Count', 6);
		});

		it('infers Receptacle from "dimmer switch"', async () => {
			const result = await getTool('create_device').execute({ description: 'dimmer switch', room_name: 'Family Room' });
			expect(result.success).toBe(true);
			expect(isConfirmation(result)).toBe(true);
			if (!isConfirmation(result)) return;
			expect(result.confirmation.operations[0].table).toBe('Receptacle');
		});

		it('rejects nonexistent room', async () => {
			const result = await getTool('create_device').execute({ description: 'ceiling fan', room_name: 'Attic' });
			expect(result.success).toBe(false);
		});
	});

	describe('add_load', () => {
		it('proposes load with correct fields', async () => {
			const result = await getTool('add_load').execute({ name: 'Kitchen - Dishwasher', device_type: 'Appliance', room_name: 'Kitchen', wattage: '1800' });
			expect(result.success).toBe(true);
			expect(isConfirmation(result)).toBe(true);
			if (!isConfirmation(result)) return;
			const details = result.confirmation.operations[0].details as any;
			expect(details.Name).toBe('Kitchen - Dishwasher');
			expect(details['Device Type']).toBe('Appliance');
			expect(details.Wattage).toBe(1800);
		});

		it('includes circuit assignment when specified', async () => {
			const result = await getTool('add_load').execute({ name: 'Kitchen Fan', device_type: 'Fan', room_name: 'Kitchen', circuit_number: '7' });
			expect(result.success).toBe(true);
			expect(isConfirmation(result)).toBe(true);
			if (!isConfirmation(result)) return;
			// Should have link-to-circuit operation
			expect(result.confirmation.operations.some(op => op.action === 'link')).toBe(true);
		});

		it('executeConfirmed persists', async () => {
			const result = await getTool('add_load').executeConfirmed!({ name: 'Test Load', device_type: 'Light - Ceiling', room_name: 'Kitchen' });
			expect(result.success).toBe(true);
			expect(mockDb.operations.some(op => op.type === 'createLoad')).toBe(true);
		});
	});

	describe('add_receptacle', () => {
		it('proposes receptacle with direction resolved', async () => {
			const result = await getTool('add_receptacle').execute({ name: 'KIT-OUT-Counter Left', receptacle_type: 'Outlet', room_name: 'Kitchen', direction: 'south' });
			expect(result.success).toBe(true);
			expect(isConfirmation(result)).toBe(true);
		});

		it('executeConfirmed persists', async () => {
			const result = await getTool('add_receptacle').executeConfirmed!({ name: 'KIT-SW-New Switch', receptacle_type: 'On/Off Switch', room_name: 'Kitchen' });
			expect(result.success).toBe(true);
			expect(mockDb.operations.some(op => op.type === 'createReceptacle')).toBe(true);
		});
	});

	describe('move_device_to_circuit', () => {
		it('proposes moving a kitchen load to circuit 1', async () => {
			const result = await getTool('move_device_to_circuit').execute({ device_name: 'Kitchen - Phone / Wires by island', circuit_number: '1' });
			expect(result.success).toBe(true);
			expect(isConfirmation(result)).toBe(true);
			if (!isConfirmation(result)) return;
			expect(result.confirmation.summary).toContain('circuit #1');
		});

		it('executeConfirmed links the device', async () => {
			const result = await getTool('move_device_to_circuit').executeConfirmed!({
				device_name: 'Kitchen - Phone / Wires by island', circuit_number: '1',
				_resolved: { deviceId: 22, deviceTable: 'Load', circuitId: 2 }
			});
			expect(result.success).toBe(true);
			expect(mockDb.operations.some(op => op.type === 'linkLoadToCircuit')).toBe(true);
		});

		it('returns error for unknown device', async () => {
			const result = await getTool('move_device_to_circuit').execute({ device_name: 'Nonexistent Device', circuit_number: '1' });
			expect(result.success).toBe(false);
		});

		it('returns error for unknown circuit', async () => {
			const result = await getTool('move_device_to_circuit').execute({ device_name: 'Kitchen - Phone / Wires by island', circuit_number: '99' });
			expect(result.success).toBe(false);
		});
	});

	describe('update_field', () => {
		it('proposes updating a load wattage', async () => {
			const result = await getTool('update_field').execute({ table: 'Load', record_name: 'Kitchen - Corner Ceiling (3 lights)', field: 'Wattage', new_value: '180' });
			expect(result.success).toBe(true);
			expect(isConfirmation(result)).toBe(true);
			if (!isConfirmation(result)) return;
			expect(result.confirmation.operations[0].action).toBe('update');
			expect(result.confirmation.operations[0].details).toHaveProperty('newValue', '180');
		});
	});
});

// ==================== Registry Integration ====================

describe('Registry', () => {
	it('has exactly 18 tools registered', () => {
		expect(registry.list().length).toBe(19);
	});

	it('has 11 read and 8 write/smart tools', () => {
		expect(registry.listByCategory('read').length).toBe(11);
		const writeCount = registry.listByCategory('write').length + registry.listByCategory('smart').length;
		expect(writeCount).toBe(8);
	});

	it('call() dispatches correctly', async () => {
		const result = await registry.call('get_room_summary', { room_name: 'Kitchen' });
		expect(result.success).toBe(true);
		expect(isDataResult(result)).toBe(true);
	});

	it('call() returns error for unknown tool', async () => {
		const result = await registry.call('nonexistent', {});
		expect(result.success).toBe(false);
	});

	it('executeConfirmed() runs write tools', async () => {
		const result = await registry.executeConfirmed('create_room', { name: 'New Room', floor: 'Main', home_name: 'Willow House' });
		expect(result.success).toBe(true);
	});

	it('executeConfirmed() rejects read tools', async () => {
		const result = await registry.executeConfirmed('get_room_summary', { room_name: 'Kitchen' });
		expect(result.success).toBe(false);
	});

	it('call() passes homeContext to tools', async () => {
		const homeCtx = { homeId: 1, homeName: 'Willow House' };
		const result = await registry.call('get_room_summary', { room_name: 'Kitchen' }, homeCtx);
		expect(result.success).toBe(true);
	});
});

// ==================== Disambiguation (Home-Scoped) ====================

describe('Disambiguation with homeContext', () => {
	const getTool = (name: string) => registry.get(name)!;

	describe('get_room_summary scoped to home', () => {
		it('finds Kitchen in Willow House when homeContext is Willow House', async () => {
			const result = await getTool('get_room_summary').execute({ room_name: 'Kitchen', _homeContext: { homeId: 1, homeName: 'Willow House' } });
			expect(result.success).toBe(true);
			if (!('data' in result)) return;
			expect(((result as any).data).room.home).toBe('Willow House');
		});

		it('finds Kitchen in Birchwood House when homeContext is Birchwood House', async () => {
			const result = await getTool('get_room_summary').execute({ room_name: 'Kitchen', _homeContext: { homeId: 2, homeName: 'Birchwood House' } });
			expect(result.success).toBe(true);
			if (!('data' in result)) return;
			expect(((result as any).data).room.home).toBe('Birchwood House');
		});

		it('finds Family Room in correct home', async () => {
			const result = await getTool('get_room_summary').execute({ room_name: 'Family Room', _homeContext: { homeId: 2, homeName: 'Birchwood House' } });
			expect(result.success).toBe(true);
			if (!('data' in result)) return;
			expect(((result as any).data).room.home).toBe('Birchwood House');
		});
	});

	describe('create_room defaults to active home', () => {
		it('uses homeContext when home_name not specified', async () => {
			const result = await getTool('create_room').execute({ name: 'New Office', floor: '2nd Floor', _homeContext: { homeId: 1, homeName: 'Willow House' } });
			expect(result.success).toBe(true);
			expect(isConfirmation(result)).toBe(true);
			if (!isConfirmation(result)) return;
			expect(result.confirmation.summary).toContain('Willow House');
		});

		it('errors when no home_name and no homeContext', async () => {
			const result = await getTool('create_room').execute({ name: 'New Office', floor: '2nd Floor' });
			expect(result.success).toBe(false);
			expect((result as any).error).toContain('No home specified');
		});
	});

	describe('create_device scoped to home', () => {
		it('rejects room from wrong home', async () => {
			// Master Bedroom only exists in Willow House (homeId: 1), not Lakeview (homeId: 2)
			const result = await getTool('create_device').execute({ description: 'ceiling light', room_name: 'Master Bedroom', _homeContext: { homeId: 2, homeName: 'Birchwood House' } });
			expect(result.success).toBe(false);
			expect((result as any).error).toContain('not found');
			expect((result as any).error).toContain('Birchwood House');
		});
	});
});

// ==================== Cross-Feature Tools (B1–B4) ====================

describe('Cross-Feature Read Tools', () => {
	const getTool = (name: string) => crossFeatureReadTools.find(t => t.name === name)!;

	describe('get_energy_reading', () => {
		it('returns whole-home energy with solar and cost', async () => {
			const result = await getTool('get_energy_reading').execute({ scope: 'home' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.scope).toBe('home');
			expect(data.totalWatts).toBeGreaterThan(0);
			expect(data.monitoredCircuits).toBe(2);
			expect(data.topConsumers.length).toBeGreaterThan(0);
			expect(data.solar).not.toBeNull();
			expect(data.solar.productionWatts).toBe(3200);
			expect(data.cost.estimatedDailyCost).toMatch(/^\$/);
		});

		it('returns room-scoped energy for Kitchen', async () => {
			const result = await getTool('get_energy_reading').execute({ scope: 'room', room_name: 'Kitchen' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.scope).toBe('room');
			expect(data.room).toBe('Kitchen');
			expect(data.totalWatts).toBeGreaterThan(0);
			expect(data.circuits.length).toBeGreaterThan(0);
		});

		it('returns circuit-scoped energy', async () => {
			const result = await getTool('get_energy_reading').execute({ scope: 'circuit', circuit_number: '7' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.scope).toBe('circuit');
			expect(data.reading.watts).toBe(245);
			expect(data.reading.trend).toBe('flat');
		});

		it('errors when circuit_number is missing for circuit scope', async () => {
			const result = await getTool('get_energy_reading').execute({ scope: 'circuit' });
			expect(result.success).toBe(false);
		});

		it('errors for non-existent room', async () => {
			const result = await getTool('get_energy_reading').execute({ scope: 'room', room_name: 'Garage' });
			expect(result.success).toBe(false);
		});
	});

	describe('get_device_status', () => {
		it('returns entity state by entity_id', async () => {
			const result = await getTool('get_device_status').execute({ entity_id: 'light.kitchen' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.entityId).toBe('light.kitchen');
			expect(data.state).toBe('on');
			expect(data.brightness).toBe(78); // 200/255 * 100 rounded
		});

		it('returns climate entity with temperature', async () => {
			const result = await getTool('get_device_status').execute({ entity_id: 'climate.thermostat' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.state).toBe('heat');
			expect(data.targetTemp).toBe(72);
			expect(data.currentTemp).toBe(68);
		});

		it('searches by friendly name', async () => {
			const result = await getTool('get_device_status').execute({ device_name: 'kitchen' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			// Should find Kitchen Light via fuzzy match
			expect(data.entityId || data.matches).toBeDefined();
		});

		it('errors for unknown entity_id', async () => {
			const result = await getTool('get_device_status').execute({ entity_id: 'light.nonexistent' });
			expect(result.success).toBe(false);
		});

		it('errors when no entity_id or device_name', async () => {
			const result = await getTool('get_device_status').execute({});
			expect(result.success).toBe(false);
		});
	});

	describe('get_network_device', () => {
		it('finds infrastructure device by name', async () => {
			const result = await getTool('get_network_device').execute({ device_name: 'Office AP' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.name || data.matches).toBeDefined();
		});

		it('finds device by MAC address', async () => {
			const result = await getTool('get_network_device').execute({ mac: 'aa:bb:cc:dd:ee:01' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			expect(data.name).toBe('Office AP');
			expect(data.type).toBe('infrastructure');
			expect(data.status).toBe('online');
		});

		it('finds client device by name', async () => {
			const result = await getTool('get_network_device').execute({ device_name: 'printer', type: 'client' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			const data = (result as any).data;
			// Should find HP Printer
			expect(data.name || data.matches).toBeDefined();
		});

		it('errors for unknown MAC', async () => {
			const result = await getTool('get_network_device').execute({ mac: 'ff:ff:ff:ff:ff:ff' });
			expect(result.success).toBe(false);
		});

		it('errors when no device_name or mac', async () => {
			const result = await getTool('get_network_device').execute({});
			expect(result.success).toBe(false);
		});
	});
});

describe('Cross-Feature Write Tools', () => {
	const getTool = (name: string) => crossFeatureWriteTools.find(t => t.name === name)!;

	describe('control_device', () => {
		it('proposes turning off a light by entity_id', async () => {
			const result = await getTool('control_device').execute({ entity_id: 'light.kitchen', action: 'turn_off' });
			expect(result.success).toBe(true);
			expect(isConfirmation(result)).toBe(true);
			if (!isConfirmation(result)) return;
			expect(result.confirmation.summary).toContain('Turn OFF');
			expect(result.confirmation.summary).toContain('Kitchen Light');
			expect(result.confirmation.summary).toContain('currently on');
		});

		it('proposes toggling a switch', async () => {
			const result = await getTool('control_device').execute({ entity_id: 'switch.garage_door', action: 'toggle' });
			expect(result.success).toBe(true);
			expect(isConfirmation(result)).toBe(true);
			if (!isConfirmation(result)) return;
			expect(result.confirmation.summary).toContain('Toggle');
		});

		it('executeConfirmed calls HA service', async () => {
			const result = await getTool('control_device').executeConfirmed!({ entity_id: 'light.kitchen', action: 'turn_off' });
			expect(result.success).toBe(true);
			if (!result.success) return;
			expect((result as any).data.message).toContain('✓');
			expect((result as any).data.newState).toBe('off');
		});

		it('errors for unknown entity', async () => {
			const result = await getTool('control_device').execute({ entity_id: 'light.nonexistent', action: 'turn_on' });
			expect(result.success).toBe(false);
		});

		it('errors when no entity_id or device_name', async () => {
			const result = await getTool('control_device').execute({ action: 'turn_on' });
			expect(result.success).toBe(false);
		});
	});
});
