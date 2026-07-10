/**
 * DataProvider interface — the abstraction layer between the app and the backing store.
 * 
 * Consumers import from `$lib/server/db` and get whichever provider is active.
 * This interface uses domain models (typed) instead of raw field bags.
 */

import type {
	Home,
	Room,
	Panel,
	Circuit,
	Load,
	Receptacle,
	Attachment,
	SearchResult,
	LinkColumnInfo,
	RoomCreate,
	LoadCreate,
	ReceptacleCreate,
	CircuitCreate
} from './models';

export interface DataProvider {
	// --- Homes ---
	getHomes(): Promise<Home[]>;
	getHome(id: number): Promise<Home | null>;
	getHomeByName(name: string): Promise<Home | null>;

	// --- Rooms (Areas) ---
	getRooms(homeId?: number): Promise<Room[]>;
	getRoom(id: number): Promise<Room | null>;
	getRoomByName(name: string, homeId?: number): Promise<Room | null>;
	createRoom(data: RoomCreate): Promise<Room>;
	updateRoom(id: number, data: Partial<RoomCreate>): Promise<void>;
	deleteRoom(id: number): Promise<void>;

	// --- Panels ---
	getPanels(homeId?: number): Promise<Panel[]>;
	getPanel(id: number): Promise<Panel | null>;
	getPanelByName(name: string): Promise<Panel | null>;

	// --- Circuits ---
	getCircuits(panelId?: number): Promise<Circuit[]>;
	getCircuit(id: number): Promise<Circuit | null>;
	getCircuitByNumber(num: number, panelName?: string): Promise<Circuit | null>;
	createCircuit(data: CircuitCreate): Promise<Circuit>;
	updateCircuit(id: number, data: Partial<CircuitCreate>): Promise<void>;

	// --- Loads ---
	getLoads(circuitId?: number, roomId?: number): Promise<Load[]>;
	getLoad(id: number): Promise<Load | null>;
	createLoad(data: LoadCreate): Promise<Load>;
	updateLoad(id: number, data: Partial<LoadCreate>): Promise<void>;
	deleteLoad(id: number): Promise<void>;
	linkLoadToCircuit(loadId: number, circuitId: number): Promise<void>;

	// --- Receptacles ---
	getReceptacles(circuitId?: number, roomId?: number): Promise<Receptacle[]>;
	getReceptacle(id: number): Promise<Receptacle | null>;
	createReceptacle(data: ReceptacleCreate): Promise<Receptacle>;
	updateReceptacle(id: number, data: Partial<ReceptacleCreate>): Promise<void>;
	deleteReceptacle(id: number): Promise<void>;
	linkReceptacleToCircuit(receptacleId: number, circuitId: number): Promise<void>;

	// --- Search ---
	searchAll(query: string): Promise<SearchResult[]>;

	// --- Files ---
	uploadFile(file: Buffer | Uint8Array, filename: string, mimetype: string): Promise<Attachment>;

	// --- Low-level (for advanced/legacy operations) ---
	/** Get raw records from a table by name. Returns untyped field bags. */
	getRawRecords(tableName: string, params?: Record<string, string>): Promise<Array<{ id: number; fields: Record<string, unknown> }>>;
	/** Update a raw record by table name and ID */
	updateRawRecord(tableName: string, recordId: number, fields: Record<string, unknown>): Promise<void>;
	/** Create a raw record in a table */
	createRawRecord(tableName: string, fields: Record<string, unknown>): Promise<{ id: number; fields: Record<string, unknown> }>;
	/** Get link columns for a table (by name) */
	getLinkColumns(tableName: string): Promise<LinkColumnInfo[]>;
	/** Add links between records */
	addLinks(tableName: string, linkColumnTitle: string, sourceRecordId: number, targetRecordIds: number[]): Promise<void>;
	/** Replace links (clear existing + set new) */
	replaceLinks(tableName: string, linkColumnTitle: string, recordId: number, linkedIds: number[]): Promise<void>;
}
