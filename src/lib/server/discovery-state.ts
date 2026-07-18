/**
 * Shared state for the device discovery system.
 * Persists ignored devices to disk so they survive server restarts.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

export type { DiscoveryItem, DiscoveryResponse } from '$lib/types/discovery';

const DATA_DIR = resolve(process.cwd(), 'data');
const IGNORED_FILE = resolve(DATA_DIR, 'ignored-devices.json');

let ignoredDevices: Set<string> | null = null;

async function loadIgnoredDevices(): Promise<Set<string>> {
	if (ignoredDevices) return ignoredDevices;
	try {
		const raw = await readFile(IGNORED_FILE, 'utf8');
		const ids = JSON.parse(raw) as string[];
		ignoredDevices = new Set(Array.isArray(ids) ? ids : []);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			ignoredDevices = new Set();
		} else {
			ignoredDevices = new Set();
		}
	}
	return ignoredDevices;
}

async function persistIgnoredDevices(): Promise<void> {
	if (!ignoredDevices) return;
	await mkdir(dirname(IGNORED_FILE), { recursive: true });
	await writeFile(IGNORED_FILE, JSON.stringify([...ignoredDevices], null, 2), 'utf8');
}

/**
 * Returns the set of ignored device IDs.
 * Lazily loads from disk on first access.
 */
export async function getIgnoredDevices(): Promise<Set<string>> {
	return loadIgnoredDevices();
}

/**
 * Add a device ID to the ignored set and persist.
 */
export async function ignoreDevice(id: string): Promise<void> {
	const set = await loadIgnoredDevices();
	set.add(id);
	await persistIgnoredDevices();
}

/**
 * Add multiple device IDs to the ignored set and persist.
 */
export async function ignoreDevices(ids: string[]): Promise<void> {
	const set = await loadIgnoredDevices();
	for (const id of ids) set.add(id);
	await persistIgnoredDevices();
}

