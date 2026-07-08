/**
 * Shared state for the device discovery system.
 * Moved out of +server.ts because SvelteKit doesn't allow non-handler exports from route files.
 */

export type { DiscoveryItem, DiscoveryResponse } from '$lib/types/discovery';

// Ignored devices stored in-memory (would be persisted in production)
const ignoredDevices = new Set<string>();

export function getIgnoredDevices(): Set<string> {
	return ignoredDevices;
}
