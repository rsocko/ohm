/**
 * Entity mapping CRUD endpoint.
 * GET: returns current mappings + unmapped HA entities + all circuits with energyMonitored flag.
 * POST: save/update a circuit → entity mapping.
 * DELETE: remove a mapping.
 */

import type { RequestHandler } from './$types';
import { discoverEmporiaEntities, checkConnection } from '$lib/server/ha-energy';
import { getEntityMappings, saveEntityMapping, deleteEntityMapping, getAllCircuits } from '$lib/server/energy-mappings';
import type { MappingResponse } from '$lib/types/energy';

export const GET: RequestHandler = async () => {
	const haConnected = await checkConnection();
	const [mappings, circuits] = await Promise.all([
		getEntityMappings(),
		getAllCircuits()
	]);

	let unmappedEntities: MappingResponse['unmappedEntities'] = [];
	if (haConnected) {
		const allEntities = await discoverEmporiaEntities();
		const mappedEntityIds = new Set(mappings.map((m) => m.entityId));
		unmappedEntities = allEntities.filter((e) => !mappedEntityIds.has(e.entityId));
	}

	return new Response(JSON.stringify({
		mappings,
		unmappedEntities,
		haConnected,
		circuits
	}), {
		headers: { 'Content-Type': 'application/json' }
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { circuitId, entityId, type } = body;

	if (!circuitId || !entityId) {
		return new Response(
			JSON.stringify({ error: 'circuitId and entityId required' }),
			{ status: 400 }
		);
	}

	await saveEntityMapping(circuitId, entityId, type || 'power');

	return new Response(JSON.stringify({ success: true }), {
		headers: { 'Content-Type': 'application/json' }
	});
};

export const DELETE: RequestHandler = async ({ url }) => {
	const circuitId = url.searchParams.get('circuit_id');
	const type = url.searchParams.get('type') || 'power';
	if (!circuitId) {
		return new Response(
			JSON.stringify({ error: 'circuit_id required' }),
			{ status: 400 }
		);
	}

	await deleteEntityMapping(parseInt(circuitId), type as 'power' | 'energy');

	return new Response(JSON.stringify({ success: true }), {
		headers: { 'Content-Type': 'application/json' }
	});
};
