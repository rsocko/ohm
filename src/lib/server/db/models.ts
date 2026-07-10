/**
 * Domain models for the electrical configuration system.
 * These are the typed representations that all consumers work with,
 * regardless of whether the backing store is NocoDB, SQLite, or anything else.
 */

export interface Home {
	id: number;
	name: string;
	address?: string;
	city?: string;
	state?: string;
	zip?: string;
}

export interface Room {
	id: number;
	name: string;
	floor?: string;
	description?: string;
	homeId?: number;
	homeName?: string;
}

export interface Panel {
	id: number;
	name: string;
	location?: string;
	serviceSize?: number;
	phases?: number;
	homeId?: number;
	homeName?: string;
}

export interface Circuit {
	id: number;
	number: number;
	amps: number;
	description?: string;
	gfciProtected?: boolean;
	breakerType?: string;
	panelId?: number;
	panelName?: string;
	roomId?: number;
	roomName?: string;
}

export interface Receptacle {
	id: number;
	name: string;
	type?: string;
	gangPosition?: number;
	locDirection?: string;
	locPlacement?: string;
	locRecIndex?: number;
	loadNames?: string;
	roomId?: number;
	roomName?: string;
	circuitId?: number;
	circuitNumber?: number;
}

export interface Load {
	id: number;
	name: string;
	deviceType?: string;
	wattage?: number;
	fixtureCount?: number;
	roomId?: number;
	roomName?: string;
	circuitId?: number;
	circuitNumber?: number;
}

/** Attachment metadata */
export interface Attachment {
	path: string;
	title: string;
	mimetype: string;
	signedPath?: string;
}

/** Generic search result spanning all tables */
export interface SearchResult {
	table: string;
	id: number;
	name: string;
	fields: Record<string, unknown>;
}

/** Link column metadata (for low-level link operations) */
export interface LinkColumnInfo {
	id: string;
	title: string;
	relatedTableId: string;
}

// --- Input types for create/update ---

export interface RoomCreate {
	name: string;
	floor?: string;
	description?: string;
	homeName?: string;
}

export interface LoadCreate {
	name: string;
	deviceType?: string;
	wattage?: number;
	fixtureCount?: number;
	roomName?: string;
	circuitNumber?: number;
	panelName?: string;
}

export interface ReceptacleCreate {
	name: string;
	type?: string;
	gangPosition?: number;
	locDirection?: string;
	locPlacement?: string;
	locRecIndex?: number;
	roomName?: string;
	circuitNumber?: number;
	panelName?: string;
}

export interface CircuitCreate {
	number: number;
	amps?: number;
	description?: string;
	gfciProtected?: boolean;
	breakerType?: string;
	panelName?: string;
	roomName?: string;
}
