import { env } from '$env/dynamic/private';
import { resolveConfigPath, readJsonConfig, writeJsonConfig } from './home-config-paths';

export interface HAConfigFile {
	url?: string;
	token?: string;
	enabled?: boolean;
	updatedAt?: string;
}

export interface HAConfig {
	url: string;
	token: string;
	enabled: boolean;
	updatedAt: string | null;
}

const DEFAULT_URL = env.HA_URL || '';
const DEFAULT_TOKEN = env.HA_TOKEN || '';
const DEFAULT_ENABLED = env.HA_ENABLED === 'true' || (!!env.HA_URL && !!env.HA_TOKEN);

// Per-home cache: homeId (or 'legacy') → { config, expiry }
const _cache = new Map<string, { config: HAConfig; expiry: number }>();
const CACHE_TTL = 60_000;

function cacheKey(homeId: number | null): string {
	return homeId != null ? String(homeId) : 'legacy';
}

function normalizeUrl(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

function resolveDefaults(fileConfig: HAConfigFile): HAConfig {
	const url = normalizeUrl(fileConfig.url || DEFAULT_URL);
	const token = (fileConfig.token ?? DEFAULT_TOKEN).trim();
	const enabled = fileConfig.enabled ?? (url && token ? true : DEFAULT_ENABLED);

	return {
		url,
		token,
		enabled,
		updatedAt: fileConfig.updatedAt || null
	};
}

export async function getHAConfig(homeId: number | null = null): Promise<HAConfig> {
	const key = cacheKey(homeId);
	const now = Date.now();
	const cached = _cache.get(key);
	if (cached && now < cached.expiry) return cached.config;

	const path = await resolveConfigPath(homeId, 'ha');
	const fileConfig = await readJsonConfig<HAConfigFile>(path);
	const config = resolveDefaults(fileConfig);
	_cache.set(key, { config, expiry: now + CACHE_TTL });
	return config;
}

/** Returns config without the token (safe to send to client). */
export async function getHAConfigSafe(homeId: number | null = null): Promise<Omit<HAConfig, 'token'> & { hasToken: boolean }> {
	const config = await getHAConfig(homeId);
	const { token, ...safe } = config;
	return { ...safe, hasToken: Boolean(token) };
}

export async function saveHAConfig(input: Partial<HAConfigFile>, homeId: number | null = null): Promise<HAConfig> {
	const currentConfig = await getHAConfig(homeId);

	const nextConfig: HAConfig = {
		url: normalizeUrl(input.url ?? currentConfig.url),
		token: (input.token ?? currentConfig.token).trim(),
		enabled: input.enabled ?? currentConfig.enabled,
		updatedAt: new Date().toISOString()
	};

	// Auto-enable when URL and token are both provided
	if (nextConfig.url && nextConfig.token && input.enabled === undefined) {
		nextConfig.enabled = true;
	}

	const path = await resolveConfigPath(homeId, 'ha');
	await writeJsonConfig(path, nextConfig);
	_cache.delete(cacheKey(homeId));
	return nextConfig;
}
