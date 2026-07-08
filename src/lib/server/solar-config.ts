/**
 * Solar configuration persistence.
 * Stores Enphase/solar entity IDs configured via the Settings UI.
 * Supports per-home configs (each home may have its own solar system).
 */

import { env } from '$env/dynamic/private';
import { resolveConfigPath, readJsonConfig, writeJsonConfig } from './home-config-paths';

export interface SolarConfigFile {
	productionEntity?: string;
	todayEntity?: string;
	lifetimeEntity?: string;
	gridImportEntity?: string;
	gridExportEntity?: string;
	utilityRatePerKwh?: number;
	updatedAt?: string;
}

export interface SolarConfig {
	productionEntity: string;
	todayEntity: string;
	lifetimeEntity: string;
	gridImportEntity: string;
	gridExportEntity: string;
	utilityRatePerKwh: number;
	updatedAt: string | null;
}

const DEFAULTS: SolarConfig = {
	productionEntity: env.HA_ENPHASE_PRODUCTION_ENTITY || 'sensor.enphase_current_power_production',
	todayEntity: env.HA_ENPHASE_TODAY_ENTITY || 'sensor.enphase_today_s_energy_production',
	lifetimeEntity: '',
	gridImportEntity: '',
	gridExportEntity: '',
	utilityRatePerKwh: parseFloat(env.UTILITY_RATE_KWH || '0.138'),
	updatedAt: null,
};

const _cache = new Map<string, { config: SolarConfig; expiry: number }>();
const CACHE_TTL = 60_000;

function cacheKey(homeId: number | null): string {
	return homeId != null ? String(homeId) : 'legacy';
}

export async function getSolarConfig(homeId: number | null = null): Promise<SolarConfig> {
	const key = cacheKey(homeId);
	const now = Date.now();
	const cached = _cache.get(key);
	if (cached && now < cached.expiry) return cached.config;

	const path = await resolveConfigPath(homeId, 'solar');
	const file = await readJsonConfig<SolarConfigFile>(path);
	const config: SolarConfig = {
		productionEntity: file.productionEntity || DEFAULTS.productionEntity,
		todayEntity: file.todayEntity || DEFAULTS.todayEntity,
		lifetimeEntity: file.lifetimeEntity || DEFAULTS.lifetimeEntity,
		gridImportEntity: file.gridImportEntity || DEFAULTS.gridImportEntity,
		gridExportEntity: file.gridExportEntity || DEFAULTS.gridExportEntity,
		utilityRatePerKwh: file.utilityRatePerKwh ?? DEFAULTS.utilityRatePerKwh,
		updatedAt: file.updatedAt || null,
	};
	_cache.set(key, { config, expiry: now + CACHE_TTL });
	return config;
}

export async function saveSolarConfig(input: Partial<SolarConfigFile>, homeId: number | null = null): Promise<SolarConfig> {
	const current = await getSolarConfig(homeId);
	const next: SolarConfig = {
		productionEntity: (input.productionEntity ?? current.productionEntity).trim(),
		todayEntity: (input.todayEntity ?? current.todayEntity).trim(),
		lifetimeEntity: (input.lifetimeEntity ?? current.lifetimeEntity).trim(),
		gridImportEntity: (input.gridImportEntity ?? current.gridImportEntity).trim(),
		gridExportEntity: (input.gridExportEntity ?? current.gridExportEntity).trim(),
		utilityRatePerKwh: input.utilityRatePerKwh ?? current.utilityRatePerKwh,
		updatedAt: new Date().toISOString(),
	};
	const path = await resolveConfigPath(homeId, 'solar');
	await writeJsonConfig(path, next);
	_cache.delete(cacheKey(homeId));
	return next;
}
