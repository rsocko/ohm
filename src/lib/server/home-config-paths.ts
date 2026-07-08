/**
 * Per-home config path resolver.
 *
 * Integration configs (HA, UniFi, Solar) are stored per-home at:
 *   data/homes/{homeId}/ha.json
 *   data/homes/{homeId}/unifi.json
 *   data/homes/{homeId}/solar.json
 *
 * Global configs (AI, Printer) remain at data/*.json
 *
 * Migration: If per-home config doesn't exist but the legacy flat file does,
 * the flat file is copied to the first home's folder on first access.
 */

import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const DATA_DIR = resolve(process.cwd(), 'data');
const HOMES_DIR = resolve(DATA_DIR, 'homes');

export type IntegrationConfigName = 'ha' | 'unifi' | 'solar';

const LEGACY_FILENAMES: Record<IntegrationConfigName, string> = {
	ha: 'ha-config.json',
	unifi: 'unifi-config.json',
	solar: 'solar-config.json'
};

const HOME_FILENAMES: Record<IntegrationConfigName, string> = {
	ha: 'ha.json',
	unifi: 'unifi.json',
	solar: 'solar.json'
};

/** Returns the per-home config path for a given integration */
export function homeConfigPath(homeId: number, configName: IntegrationConfigName): string {
	return resolve(HOMES_DIR, String(homeId), HOME_FILENAMES[configName]);
}

/** Returns the legacy (flat) config path */
export function legacyConfigPath(configName: IntegrationConfigName): string {
	return resolve(DATA_DIR, LEGACY_FILENAMES[configName]);
}

/** Ensure the per-home directory exists */
export async function ensureHomeDir(homeId: number): Promise<void> {
	await mkdir(resolve(HOMES_DIR, String(homeId)), { recursive: true });
}

/** Check if a file exists */
async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve the config file path for a given home + integration.
 * - If homeId is provided and per-home file exists → use it
 * - If homeId is provided and per-home doesn't exist but legacy does → migrate (copy) and use per-home
 * - If homeId is null → use legacy path (backward compat for single-home setups)
 */
export async function resolveConfigPath(
	homeId: number | null,
	configName: IntegrationConfigName
): Promise<string> {
	// No homeId → legacy behavior
	if (homeId === null) {
		return legacyConfigPath(configName);
	}

	const homePath = homeConfigPath(homeId, configName);

	// Per-home file exists → use it
	if (await fileExists(homePath)) {
		return homePath;
	}

	// Per-home doesn't exist — check if legacy file exists to migrate
	const legacy = legacyConfigPath(configName);
	if (await fileExists(legacy)) {
		await ensureHomeDir(homeId);
		await copyFile(legacy, homePath);
		return homePath;
	}

	// Neither exists — return per-home path (will be created on first save)
	return homePath;
}

/**
 * Read a JSON config file, returning empty object if not found.
 */
export async function readJsonConfig<T = Record<string, unknown>>(path: string): Promise<T> {
	try {
		const raw = await readFile(path, 'utf8');
		return JSON.parse(raw) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return {} as T;
		}
		throw error;
	}
}

/**
 * Write a JSON config file, creating directories as needed.
 */
export async function writeJsonConfig(path: string, data: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
