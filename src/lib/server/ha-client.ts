/**
 * High-level Home Assistant client.
 * Built on ha-transport.ts — provides entity queries, service calls, areas, and status.
 * Server-side only.
 */

import { haFetch, isConfigured, testConnection, type HAEntityState } from './ha-transport';

// Re-export transport utilities needed by routes
export { isConfigured };

// Re-export the canonical entity state type
export type { HAEntityState };

export interface HAConnectionStatus {
	connected: boolean;
	version?: string;
	location_name?: string;
	entity_count?: number;
	error?: string;
}

export interface HAServiceCallRequest {
	entity_id: string;
	action: 'turn_on' | 'turn_off' | 'toggle';
	data?: Record<string, unknown>;
}

export interface HAServiceCallResponse {
	success: boolean;
	new_state?: string;
	error?: string;
}

/**
 * Test HA connection and return detailed status.
 */
export async function getStatus(): Promise<HAConnectionStatus> {
	const configured = await isConfigured();
	if (!configured) {
		return { connected: false, error: 'Home Assistant integration is not configured' };
	}

	const info = await testConnection();
	if (!info) {
		return { connected: false, error: 'Connection failed' };
	}

	try {
		const states = await haFetch<HAEntityState[]>('/api/states');
		return {
			connected: true,
			version: info.version,
			location_name: info.location_name,
			entity_count: states.length
		};
	} catch {
		return {
			connected: true,
			version: info.version,
			location_name: info.location_name,
			entity_count: undefined
		};
	}
}

/**
 * Fetch entity states, optionally filtered by domain or entity IDs.
 */
export async function getEntities(options?: {
	domain?: string;
	entity_ids?: string[];
}): Promise<HAEntityState[]> {
	const configured = await isConfigured();
	if (!configured) return [];

	try {
		let entities = await haFetch<HAEntityState[]>('/api/states');

		if (options?.domain) {
			entities = entities.filter((e) => e.entity_id.startsWith(`${options.domain}.`));
		}

		if (options?.entity_ids) {
			const ids = new Set(options.entity_ids);
			entities = entities.filter((e) => ids.has(e.entity_id));
		}

		return entities;
	} catch {
		return [];
	}
}

/**
 * Get a single entity state.
 */
export async function getEntity(entityId: string): Promise<HAEntityState | null> {
	const configured = await isConfigured();
	if (!configured) return null;

	try {
		return await haFetch<HAEntityState>(`/api/states/${entityId}`);
	} catch {
		return null;
	}
}

/**
 * Call a HA service (turn_on, turn_off, toggle).
 */
export async function callService(request: HAServiceCallRequest): Promise<HAServiceCallResponse> {
	const configured = await isConfigured();
	if (!configured) {
		return { success: false, error: 'Home Assistant integration is not configured' };
	}

	const [domain] = request.entity_id.split('.');
	try {
		await haFetch(`/api/services/${domain}/${request.action}`, {
			method: 'POST',
			body: { entity_id: request.entity_id, ...request.data }
		});

		const entity = await getEntity(request.entity_id);
		return { success: true, new_state: entity?.state };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : 'Service call failed'
		};
	}
}

/**
 * List HA areas via template API.
 */
export async function getAreas(): Promise<Array<{ area_id: string; name: string }>> {
	const configured = await isConfigured();
	if (!configured) return [];

	try {
		const areaIdsRaw = await haFetch<string>('/api/template', {
			method: 'POST',
			body: { template: '{{ areas() | list | tojson }}' }
		});
		const areaIds: string[] = JSON.parse(String(areaIdsRaw));

		const areas = await Promise.all(
			areaIds.map(async (id) => {
				try {
					const name = await haFetch<string>('/api/template', {
						method: 'POST',
						body: { template: `{{ area_name('${id}') }}` }
					});
					return { area_id: id, name: String(name).trim() };
				} catch {
					return { area_id: id, name: id };
				}
			})
		);

		return areas;
	} catch {
		return [];
	}
}

/**
 * Check HA connection (boolean convenience).
 */
export async function checkConnection(): Promise<boolean> {
	const info = await testConnection();
	return info !== null;
}
