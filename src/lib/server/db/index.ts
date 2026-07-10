/**
 * Database provider barrel export.
 * 
 * All server code that needs data access should import from here:
 *   import { db } from '$lib/server/db';
 * 
 * The active provider is selected by the DB_PROVIDER env var.
 * Currently only 'nocodb' is implemented; 'sqlite' will be added in Phase 2.
 */

export type { DataProvider } from './provider';
export type {
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
export {
	entityAliases,
	fieldAliases,
	deviceTypeInference,
	receptacleTypeInference,
	directionAliases,
	resolveEntityAlias,
	inferDeviceType,
	inferReceptacleType,
	inferEntityFromDescription,
	resolveDirection,
	getVocabularySummary
} from './vocabulary';

import { NocoDBProvider } from './nocodb-provider';
import type { DataProvider } from './provider';

// Singleton instance — lazy-initialized on first access
let _provider: DataProvider | null = null;

export function getProvider(): DataProvider {
	if (!_provider) {
		// Future: check env.DB_PROVIDER to select between providers
		_provider = new NocoDBProvider();
	}
	return _provider;
}

/** Convenience alias */
export const db: DataProvider = new NocoDBProvider();
