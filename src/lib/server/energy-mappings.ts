/**
 * Energy entity mapping management.
 * Reads/writes ha_energy_entity_id on NocoDB circuit records.
 * Uses the shared nocodb.ts module for API access.
 * Caches mappings in memory with periodic refresh.
 */

import type { EntityMapping } from '$lib/types/energy';
import { getTableByName, getRecords, updateRecord, type V3Record } from './nocodb';

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes — invalidated on write
let mappingsCache: EntityMapping[] | null = null;
let lastCacheTime = 0;
let circuitsTableId: string | null = null;

/**
 * Resolve the NocoDB table ID for "Circuits" (cached after first lookup).
 */
async function getCircuitsTableId(): Promise<string> {
	if (circuitsTableId) return circuitsTableId;
	const table = await getTableByName('Circuit');
	if (!table) {
		throw new Error('Circuits table not found in NocoDB. Check your database configuration.');
	}
	circuitsTableId = table.id;
	return circuitsTableId;
}

/**
 * Get all circuit → entity mappings from NocoDB.
 * Uses in-memory cache with 30-min TTL.
 */
export async function getEntityMappings(): Promise<EntityMapping[]> {
	if (mappingsCache && Date.now() - lastCacheTime < CACHE_TTL) {
		return mappingsCache;
	}

	try {
		const tableId = await getCircuitsTableId();
		const records = await getRecords(tableId, { limit: '200' });

		const mappings: EntityMapping[] = [];
		for (const record of records) {
			const powerEntity = record.fields?.ha_power_entity_id;
			const energyEntity = record.fields?.ha_energy_entity_id;
			// Include circuit if it has either mapping
			if ((!powerEntity || typeof powerEntity !== 'string') &&
				(!energyEntity || typeof energyEntity !== 'string')) continue;

			mappings.push({
				circuitId: record.id,
				circuitName: String(record.fields?.Name || record.fields?.name || `Circuit ${record.id}`),
				panelName: extractPanelName(record),
				entityId: (powerEntity as string) || (energyEntity as string),
				powerEntityId: typeof powerEntity === 'string' ? powerEntity : null,
				energyEntityId: typeof energyEntity === 'string' ? energyEntity : null,
				ampRating: Number(record.fields?.['Amp Rating'] || record.fields?.amp_rating || 20),
				voltage: Number(record.fields?.Voltage || record.fields?.voltage || 120)
			});
		}

		mappingsCache = mappings;
		lastCacheTime = Date.now();
		return mappings;
	} catch (err) {
		if (mappingsCache) return mappingsCache;
		throw err;
	}
}

/**
 * Save a circuit → entity mapping to NocoDB.
 */
export async function saveEntityMapping(circuitId: number, entityId: string, type: 'power' | 'energy' = 'power'): Promise<void> {
	const tableId = await getCircuitsTableId();
	const field = type === 'energy' ? 'ha_energy_entity_id' : 'ha_power_entity_id';
	await updateRecord(tableId, circuitId, { [field]: entityId });
	mappingsCache = null;
}

/**
 * Remove entity mapping from a circuit.
 */
export async function deleteEntityMapping(circuitId: number, type: 'power' | 'energy' = 'power'): Promise<void> {
	const tableId = await getCircuitsTableId();
	const field = type === 'energy' ? 'ha_energy_entity_id' : 'ha_power_entity_id';
	await updateRecord(tableId, circuitId, { [field]: null });
	mappingsCache = null;
}

/**
 * Get all circuits (for mapping UI).
 * Includes energyMonitored flag and circuit number for display.
 */
export async function getAllCircuits(): Promise<MappableCircuit[]> {
	const tableId = await getCircuitsTableId();
	const records = await getRecords(tableId, { limit: '200' });

	return records.map((record) => ({
		id: record.id,
		name: String(record.fields?.Name || record.fields?.name || `Circuit ${record.id}`),
		number: Number(record.fields?.Number || 0),
		panelName: extractPanelName(record),
		powerEntityId: record.fields?.ha_power_entity_id ? String(record.fields.ha_power_entity_id) : null,
		energyEntityId: record.fields?.ha_energy_entity_id ? String(record.fields.ha_energy_entity_id) : null,
		energyMonitored: Boolean(record.fields?.['Energy Monitored']),
		amps: Number(record.fields?.Amps || record.fields?.['Amp Rating'] || 20)
	}));
}

export interface MappableCircuit {
	id: number;
	name: string;
	number: number;
	panelName: string;
	powerEntityId: string | null;
	energyEntityId: string | null;
	energyMonitored: boolean;
	amps: number;
}

/**
 * Extract panel name from a record, handling linked-record fields (arrays).
 */
function extractPanelName(record: V3Record): string {
	const panel = record.fields?.Panel || record.fields?.panel;
	if (!panel) return 'Unknown';
	// V3 linked record: {id, id_fields, fields: {Name: "..."}} or array of same
	const item = Array.isArray(panel) ? panel[0] : panel;
	if (typeof item === 'object' && item !== null) {
		const obj = item as Record<string, unknown>;
		// V3 format: fields.Name
		if (obj.fields && typeof obj.fields === 'object') {
			const fields = obj.fields as Record<string, unknown>;
			return String(fields.Name || fields.name || fields.Title || fields.title || 'Unknown');
		}
		// V2 format: {Title} or {Name}
		return String(obj.Name || obj.name || obj.Title || obj.title || 'Unknown');
	}
	return String(item || 'Unknown');
}
