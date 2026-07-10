/**
 * NocoDB provider — implements DataProvider by wrapping the existing nocodb.ts functions.
 * This is a thin adapter: all NocoDB-specific details (API versions, field names,
 * link column mechanics) are encapsulated here.
 */

import type { DataProvider } from './provider';
import type {
	Home, Room, Panel, Circuit, Load, Receptacle,
	Attachment, SearchResult, LinkColumnInfo,
	RoomCreate, LoadCreate, ReceptacleCreate, CircuitCreate
} from './models';
import {
	listTables,
	getRecords,
	getRecordById,
	getTableByName,
	getTableMeta,
	searchAllTables,
	updateRecord,
	deleteRecord,
	createRecord,
	getLinkColumns as getNocoLinkColumns,
	addLinks as nocoAddLinks,
	replaceLinks as nocoReplaceLinks,
	uploadFile as nocoUploadFile,
	type V3Record,
	type Table
} from '../nocodb';

// --- Field mapping helpers ---

function toHome(r: V3Record): Home {
	return {
		id: r.id,
		name: String(r.fields['Name'] || ''),
		address: r.fields['Address'] as string | undefined,
		city: r.fields['City'] as string | undefined,
		state: r.fields['State'] as string | undefined,
		zip: r.fields['Zip'] as string | undefined,
	};
}

function toRoom(r: V3Record): Room {
	const home = r.fields['Home'] as { id?: number; fields?: Record<string, unknown> } | undefined;
	return {
		id: r.id,
		name: String(r.fields['Name'] || ''),
		floor: r.fields['Floor'] as string | undefined,
		description: r.fields['Description'] as string | undefined,
		homeId: home?.id,
		homeName: home?.fields?.['Name'] as string | undefined,
	};
}

function toPanel(r: V3Record): Panel {
	const home = r.fields['Home'] as { id?: number; fields?: Record<string, unknown> } | undefined;
	return {
		id: r.id,
		name: String(r.fields['Name'] || ''),
		location: r.fields['Location'] as string | undefined,
		serviceSize: r.fields['Service Size'] as number | undefined,
		phases: r.fields['Phases'] as number | undefined,
		homeId: home?.id,
		homeName: home?.fields?.['Name'] as string | undefined,
	};
}

function toCircuit(r: V3Record): Circuit {
	const panel = r.fields['Panel'] as { id?: number; fields?: Record<string, unknown> } | undefined;
	const area = r.fields['Area'] as { id?: number; fields?: Record<string, unknown> } | undefined;
	return {
		id: r.id,
		number: Number(r.fields['Number'] || 0),
		amps: Number(r.fields['Amps'] || 20),
		description: r.fields['Description'] as string | undefined,
		gfciProtected: r.fields['GFCI Protected'] as boolean | undefined,
		breakerType: r.fields['Breaker Type'] as string | undefined,
		panelId: panel?.id,
		panelName: panel?.fields?.['Name'] as string | undefined,
		roomId: area?.id,
		roomName: area?.fields?.['Name'] as string | undefined,
	};
}

function toLoad(r: V3Record): Load {
	const area = r.fields['Area'] as { id?: number; fields?: Record<string, unknown> } | undefined;
	const circuit = r.fields['Circuit'] as { id?: number; fields?: Record<string, unknown> } | undefined;
	return {
		id: r.id,
		name: String(r.fields['Name'] || ''),
		deviceType: r.fields['Device Type'] as string | undefined,
		wattage: r.fields['Wattage'] as number | undefined,
		fixtureCount: r.fields['Fixture_Count'] as number | undefined,
		roomId: area?.id,
		roomName: area?.fields?.['Name'] as string | undefined,
		circuitId: circuit?.id,
		circuitNumber: circuit?.fields?.['Number'] as number | undefined,
	};
}

function toReceptacle(r: V3Record): Receptacle {
	const area = r.fields['Area'] as { id?: number; fields?: Record<string, unknown> } | undefined;
	const circuit = r.fields['Circuit'] as { id?: number; fields?: Record<string, unknown> } | undefined;
	return {
		id: r.id,
		name: String(r.fields['Name'] || ''),
		type: r.fields['Receptacle Type'] as string | undefined,
		gangPosition: r.fields['Gang Position'] as number | undefined,
		locDirection: r.fields['Loc.Direction'] as string | undefined,
		locPlacement: r.fields['Loc.Placement'] as string | undefined,
		locRecIndex: r.fields['Loc.Rec.Index'] as number | undefined,
		loadNames: r.fields['Load Name(s)'] as string | undefined,
		roomId: area?.id,
		roomName: area?.fields?.['Name'] as string | undefined,
		circuitId: circuit?.id,
		circuitNumber: circuit?.fields?.['Number'] as number | undefined,
	};
}

// --- Helper to get table ID with caching ---

const tableCache = new Map<string, Table>();

async function resolveTable(name: string): Promise<Table> {
	const cached = tableCache.get(name.toLowerCase());
	if (cached) return cached;
	const table = await getTableByName(name);
	if (!table) throw new Error(`Table "${name}" not found in NocoDB`);
	tableCache.set(name.toLowerCase(), table);
	return table;
}

// --- Helper to resolve a record by name in a table ---

async function findRecordByName(tableName: string, name: string): Promise<V3Record | null> {
	const table = await resolveTable(tableName);
	const records = await getRecords(table.id, { pageSize: '200' });
	return records.find(r =>
		String(r.fields['Name'] || '').toLowerCase() === name.toLowerCase()
	) || null;
}

// --- Helper to link a record to a target by name ---

async function linkByName(
	sourceTableName: string,
	sourceRecordId: number,
	linkColumnTitle: string,
	targetName: string
): Promise<void> {
	const sourceTable = await resolveTable(sourceTableName);
	const linkCols = await getNocoLinkColumns(sourceTable.id);
	const linkCol = linkCols.find(c => c.title === linkColumnTitle);
	if (!linkCol) throw new Error(`Link column "${linkColumnTitle}" not found on ${sourceTableName}`);

	const targetRecords = await getRecords(linkCol.fk_related_model_id, { pageSize: '200' });
	const target = targetRecords.find(r =>
		String(r.fields['Name'] || '').toLowerCase() === targetName.toLowerCase()
	);
	if (!target) throw new Error(`No record named "${targetName}" found for link column "${linkColumnTitle}"`);

	await nocoAddLinks(sourceTable.id, linkCol.id, sourceRecordId, [target.id]);
}

// ==========================================================================
// NocoDB DataProvider Implementation
// ==========================================================================

export class NocoDBProvider implements DataProvider {
	// --- Homes ---

	async getHomes(): Promise<Home[]> {
		const table = await resolveTable('Home');
		const records = await getRecords(table.id, { pageSize: '100' });
		return records.map(toHome);
	}

	async getHome(id: number): Promise<Home | null> {
		const table = await resolveTable('Home');
		const record = await getRecordById(table.id, id);
		return record ? toHome(record) : null;
	}

	async getHomeByName(name: string): Promise<Home | null> {
		const record = await findRecordByName('Home', name);
		return record ? toHome(record) : null;
	}

	// --- Rooms (Areas) ---

	async getRooms(homeId?: number): Promise<Room[]> {
		const table = await resolveTable('Area');
		const records = await getRecords(table.id, { pageSize: '200' });
		const rooms = records.map(toRoom);
		if (homeId !== undefined) return rooms.filter(r => r.homeId === homeId);
		return rooms;
	}

	async getRoom(id: number): Promise<Room | null> {
		const table = await resolveTable('Area');
		const record = await getRecordById(table.id, id);
		return record ? toRoom(record) : null;
	}

	async getRoomByName(name: string, homeId?: number): Promise<Room | null> {
		const rooms = await this.getRooms(homeId);
		return rooms.find(r => r.name.toLowerCase() === name.toLowerCase()) || null;
	}

	async createRoom(data: RoomCreate): Promise<Room> {
		const table = await resolveTable('Area');
		const fields: Record<string, unknown> = { Name: data.name };
		if (data.floor) fields['Floor'] = data.floor;
		if (data.description) fields['Description'] = data.description;

		const record = await createRecord(table.id, fields);
		const room = toRoom(record);

		// Auto-link to home if specified
		if (data.homeName) {
			await linkByName('Area', record.id, 'Home', data.homeName);
			room.homeName = data.homeName;
		}

		return room;
	}

	async updateRoom(id: number, data: Partial<RoomCreate>): Promise<void> {
		const table = await resolveTable('Area');
		const fields: Record<string, unknown> = {};
		if (data.name !== undefined) fields['Name'] = data.name;
		if (data.floor !== undefined) fields['Floor'] = data.floor;
		if (data.description !== undefined) fields['Description'] = data.description;
		if (Object.keys(fields).length > 0) {
			await updateRecord(table.id, id, fields);
		}
		if (data.homeName) {
			await linkByName('Area', id, 'Home', data.homeName);
		}
	}

	async deleteRoom(id: number): Promise<void> {
		const table = await resolveTable('Area');
		await deleteRecord(table.id, id);
	}

	// --- Panels ---

	async getPanels(homeId?: number): Promise<Panel[]> {
		const table = await resolveTable('Panel');
		const records = await getRecords(table.id, { pageSize: '100' });
		const panels = records.map(toPanel);
		if (homeId !== undefined) return panels.filter(p => p.homeId === homeId);
		return panels;
	}

	async getPanel(id: number): Promise<Panel | null> {
		const table = await resolveTable('Panel');
		const record = await getRecordById(table.id, id);
		return record ? toPanel(record) : null;
	}

	async getPanelByName(name: string): Promise<Panel | null> {
		const panels = await this.getPanels();
		return panels.find(p => p.name.toLowerCase() === name.toLowerCase()) || null;
	}

	// --- Circuits ---

	async getCircuits(panelId?: number): Promise<Circuit[]> {
		const table = await resolveTable('Circuit');
		const records = await getRecords(table.id, { pageSize: '200' });
		const circuits = records.map(toCircuit);
		if (panelId !== undefined) return circuits.filter(c => c.panelId === panelId);
		return circuits;
	}

	async getCircuit(id: number): Promise<Circuit | null> {
		const table = await resolveTable('Circuit');
		const record = await getRecordById(table.id, id);
		return record ? toCircuit(record) : null;
	}

	async getCircuitByNumber(num: number, panelName?: string): Promise<Circuit | null> {
		const circuits = await this.getCircuits();
		return circuits.find(c =>
			c.number === num && (!panelName || c.panelName?.toLowerCase() === panelName.toLowerCase())
		) || null;
	}

	async createCircuit(data: CircuitCreate): Promise<Circuit> {
		const table = await resolveTable('Circuit');
		const fields: Record<string, unknown> = { Number: data.number };
		if (data.amps) fields['Amps'] = data.amps;
		if (data.description) fields['Description'] = data.description;
		if (data.gfciProtected !== undefined) fields['GFCI Protected'] = data.gfciProtected;
		if (data.breakerType) fields['Breaker Type'] = data.breakerType;

		const record = await createRecord(table.id, fields);
		const circuit = toCircuit(record);

		if (data.panelName) await linkByName('Circuit', record.id, 'Panel', data.panelName);
		if (data.roomName) await linkByName('Circuit', record.id, 'Area', data.roomName);

		return circuit;
	}

	async updateCircuit(id: number, data: Partial<CircuitCreate>): Promise<void> {
		const table = await resolveTable('Circuit');
		const fields: Record<string, unknown> = {};
		if (data.number !== undefined) fields['Number'] = data.number;
		if (data.amps !== undefined) fields['Amps'] = data.amps;
		if (data.description !== undefined) fields['Description'] = data.description;
		if (data.gfciProtected !== undefined) fields['GFCI Protected'] = data.gfciProtected;
		if (Object.keys(fields).length > 0) {
			await updateRecord(table.id, id, fields);
		}
		if (data.panelName) await linkByName('Circuit', id, 'Panel', data.panelName);
		if (data.roomName) await linkByName('Circuit', id, 'Area', data.roomName);
	}

	// --- Loads ---

	async getLoads(circuitId?: number, roomId?: number): Promise<Load[]> {
		const table = await resolveTable('Load');
		const records = await getRecords(table.id, { pageSize: '200' });
		let loads = records.map(toLoad);
		if (circuitId !== undefined) loads = loads.filter(l => l.circuitId === circuitId);
		if (roomId !== undefined) loads = loads.filter(l => l.roomId === roomId);
		return loads;
	}

	async getLoad(id: number): Promise<Load | null> {
		const table = await resolveTable('Load');
		const record = await getRecordById(table.id, id);
		return record ? toLoad(record) : null;
	}

	async createLoad(data: LoadCreate): Promise<Load> {
		const table = await resolveTable('Load');
		const fields: Record<string, unknown> = { Name: data.name };
		if (data.deviceType) fields['Device Type'] = data.deviceType;
		if (data.wattage) fields['Wattage'] = data.wattage;
		if (data.fixtureCount) fields['Fixture_Count'] = data.fixtureCount;

		const record = await createRecord(table.id, fields);
		const load = toLoad(record);

		if (data.roomName) await linkByName('Load', record.id, 'Area', data.roomName);
		if (data.circuitNumber !== undefined) {
			const circuit = await this.getCircuitByNumber(data.circuitNumber, data.panelName);
			if (circuit) {
				const sourceTable = await resolveTable('Load');
				const linkCols = await getNocoLinkColumns(sourceTable.id);
				const circuitLink = linkCols.find(c => c.title === 'Circuit');
				if (circuitLink) {
					await nocoAddLinks(sourceTable.id, circuitLink.id, record.id, [circuit.id]);
				}
			}
		}

		return load;
	}

	async updateLoad(id: number, data: Partial<LoadCreate>): Promise<void> {
		const table = await resolveTable('Load');
		const fields: Record<string, unknown> = {};
		if (data.name !== undefined) fields['Name'] = data.name;
		if (data.deviceType !== undefined) fields['Device Type'] = data.deviceType;
		if (data.wattage !== undefined) fields['Wattage'] = data.wattage;
		if (data.fixtureCount !== undefined) fields['Fixture_Count'] = data.fixtureCount;
		if (Object.keys(fields).length > 0) {
			await updateRecord(table.id, id, fields);
		}
		if (data.roomName) await linkByName('Load', id, 'Area', data.roomName);
	}

	async deleteLoad(id: number): Promise<void> {
		const table = await resolveTable('Load');
		await deleteRecord(table.id, id);
	}

	async linkLoadToCircuit(loadId: number, circuitId: number): Promise<void> {
		const table = await resolveTable('Load');
		const linkCols = await getNocoLinkColumns(table.id);
		const circuitLink = linkCols.find(c => c.title === 'Circuit');
		if (!circuitLink) throw new Error('Circuit link column not found on Load table');
		await nocoAddLinks(table.id, circuitLink.id, loadId, [circuitId]);
	}

	// --- Receptacles ---

	async getReceptacles(circuitId?: number, roomId?: number): Promise<Receptacle[]> {
		const table = await resolveTable('Receptacle');
		const records = await getRecords(table.id, { pageSize: '200' });
		let recs = records.map(toReceptacle);
		if (circuitId !== undefined) recs = recs.filter(r => r.circuitId === circuitId);
		if (roomId !== undefined) recs = recs.filter(r => r.roomId === roomId);
		return recs;
	}

	async getReceptacle(id: number): Promise<Receptacle | null> {
		const table = await resolveTable('Receptacle');
		const record = await getRecordById(table.id, id);
		return record ? toReceptacle(record) : null;
	}

	async createReceptacle(data: ReceptacleCreate): Promise<Receptacle> {
		const table = await resolveTable('Receptacle');
		const fields: Record<string, unknown> = { Name: data.name };
		if (data.type) fields['Receptacle Type'] = data.type;
		if (data.gangPosition) fields['Gang Position'] = data.gangPosition;
		if (data.locDirection) fields['Loc.Direction'] = data.locDirection;
		if (data.locPlacement) fields['Loc.Placement'] = data.locPlacement;
		if (data.locRecIndex) fields['Loc.Rec.Index'] = data.locRecIndex;

		const record = await createRecord(table.id, fields);
		const receptacle = toReceptacle(record);

		if (data.roomName) await linkByName('Receptacle', record.id, 'Area', data.roomName);
		if (data.circuitNumber !== undefined) {
			const circuit = await this.getCircuitByNumber(data.circuitNumber, data.panelName);
			if (circuit) {
				const linkCols = await getNocoLinkColumns(table.id);
				const circuitLink = linkCols.find(c => c.title === 'Circuit');
				if (circuitLink) {
					await nocoAddLinks(table.id, circuitLink.id, record.id, [circuit.id]);
				}
			}
		}

		return receptacle;
	}

	async updateReceptacle(id: number, data: Partial<ReceptacleCreate>): Promise<void> {
		const table = await resolveTable('Receptacle');
		const fields: Record<string, unknown> = {};
		if (data.name !== undefined) fields['Name'] = data.name;
		if (data.type !== undefined) fields['Receptacle Type'] = data.type;
		if (data.gangPosition !== undefined) fields['Gang Position'] = data.gangPosition;
		if (data.locDirection !== undefined) fields['Loc.Direction'] = data.locDirection;
		if (data.locPlacement !== undefined) fields['Loc.Placement'] = data.locPlacement;
		if (data.locRecIndex !== undefined) fields['Loc.Rec.Index'] = data.locRecIndex;
		if (Object.keys(fields).length > 0) {
			await updateRecord(table.id, id, fields);
		}
		if (data.roomName) await linkByName('Receptacle', id, 'Area', data.roomName);
	}

	async deleteReceptacle(id: number): Promise<void> {
		const table = await resolveTable('Receptacle');
		await deleteRecord(table.id, id);
	}

	async linkReceptacleToCircuit(receptacleId: number, circuitId: number): Promise<void> {
		const table = await resolveTable('Receptacle');
		const linkCols = await getNocoLinkColumns(table.id);
		const circuitLink = linkCols.find(c => c.title === 'Circuit');
		if (!circuitLink) throw new Error('Circuit link column not found on Receptacle table');
		await nocoAddLinks(table.id, circuitLink.id, receptacleId, [circuitId]);
	}

	// --- Search ---

	async searchAll(query: string): Promise<SearchResult[]> {
		const raw = await searchAllTables(query);
		const results: SearchResult[] = [];
		for (const [tableName, records] of Object.entries(raw)) {
			for (const r of records) {
				results.push({
					table: tableName,
					id: r.id,
					name: String(r.fields['Name'] || r.fields['Number'] || `#${r.id}`),
					fields: r.fields
				});
			}
		}
		return results;
	}

	// --- Files ---

	async uploadFile(file: Buffer | Uint8Array, filename: string, mimetype: string): Promise<Attachment> {
		return await nocoUploadFile(file, filename, mimetype);
	}

	// --- Low-level / raw operations ---

	async getRawRecords(tableName: string, params?: Record<string, string>): Promise<Array<{ id: number; fields: Record<string, unknown> }>> {
		const table = await resolveTable(tableName);
		const records = await getRecords(table.id, params);
		return records.map(r => ({ id: r.id, fields: r.fields }));
	}

	async updateRawRecord(tableName: string, recordId: number, fields: Record<string, unknown>): Promise<void> {
		const table = await resolveTable(tableName);
		await updateRecord(table.id, recordId, fields);
	}

	async createRawRecord(tableName: string, fields: Record<string, unknown>): Promise<{ id: number; fields: Record<string, unknown> }> {
		const table = await resolveTable(tableName);
		const record = await createRecord(table.id, fields);
		return { id: record.id, fields: record.fields };
	}

	async getLinkColumns(tableName: string): Promise<LinkColumnInfo[]> {
		const table = await resolveTable(tableName);
		const cols = await getNocoLinkColumns(table.id);
		return cols.map(c => ({
			id: c.id,
			title: c.title,
			relatedTableId: c.fk_related_model_id
		}));
	}

	async addLinks(tableName: string, linkColumnTitle: string, sourceRecordId: number, targetRecordIds: number[]): Promise<void> {
		const table = await resolveTable(tableName);
		const linkCols = await getNocoLinkColumns(table.id);
		const col = linkCols.find(c => c.title === linkColumnTitle);
		if (!col) throw new Error(`Link column "${linkColumnTitle}" not found on ${tableName}`);
		await nocoAddLinks(table.id, col.id, sourceRecordId, targetRecordIds);
	}

	async replaceLinks(tableName: string, linkColumnTitle: string, recordId: number, linkedIds: number[]): Promise<void> {
		const table = await resolveTable(tableName);
		const linkCols = await getNocoLinkColumns(table.id);
		const col = linkCols.find(c => c.title === linkColumnTitle);
		if (!col) throw new Error(`Link column "${linkColumnTitle}" not found on ${tableName}`);
		await nocoReplaceLinks(table.id, col.id, recordId, linkedIds);
	}
}
