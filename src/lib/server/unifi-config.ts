import { env } from '$env/dynamic/private';
import { resolveConfigPath, readJsonConfig, writeJsonConfig } from './home-config-paths';

export interface UnifiConfigFile {
	url?: string;
	username?: string;
	password?: string;
	site?: string;
	verifySsl?: boolean;
	lastSyncAt?: string;
	updatedAt?: string;
}

export interface UnifiConfig {
	url: string;
	username: string;
	password: string;
	site: string;
	verifySsl: boolean;
	lastSyncAt: string | null;
	updatedAt: string | null;
}

const DEFAULT_URL = env.UNIFI_URL || '';
const DEFAULT_USERNAME = env.UNIFI_USERNAME || '';
const DEFAULT_PASSWORD = env.UNIFI_PASSWORD || '';
const DEFAULT_SITE = env.UNIFI_SITE || 'default';
const DEFAULT_VERIFY_SSL = env.UNIFI_VERIFY_SSL !== 'false';

const _cache = new Map<string, { config: UnifiConfig; expiry: number }>();
const CACHE_TTL = 60_000;

function cacheKey(homeId: number | null): string {
	return homeId != null ? String(homeId) : 'legacy';
}

function normalizeUrl(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

function resolveDefaults(fileConfig: UnifiConfigFile): UnifiConfig {
	return {
		url: normalizeUrl(fileConfig.url || DEFAULT_URL),
		username: (fileConfig.username ?? DEFAULT_USERNAME).trim(),
		password: (fileConfig.password ?? DEFAULT_PASSWORD).trim(),
		site: (fileConfig.site || DEFAULT_SITE).trim(),
		verifySsl: fileConfig.verifySsl ?? DEFAULT_VERIFY_SSL,
		lastSyncAt: fileConfig.lastSyncAt || null,
		updatedAt: fileConfig.updatedAt || null
	};
}

export async function getUnifiConfig(homeId: number | null = null): Promise<UnifiConfig> {
	const key = cacheKey(homeId);
	const now = Date.now();
	const cached = _cache.get(key);
	if (cached && now < cached.expiry) return cached.config;

	const path = await resolveConfigPath(homeId, 'unifi');
	const fileConfig = await readJsonConfig<UnifiConfigFile>(path);
	const config = resolveDefaults(fileConfig);
	_cache.set(key, { config, expiry: now + CACHE_TTL });
	return config;
}

/** Returns config without the password (safe to send to client). */
export async function getUnifiConfigSafe(homeId: number | null = null): Promise<Omit<UnifiConfig, 'password'> & { hasPassword: boolean }> {
	const config = await getUnifiConfig(homeId);
	const { password, ...safe } = config;
	return { ...safe, hasPassword: Boolean(password) };
}

export async function saveUnifiConfig(
	input: Partial<UnifiConfigFile>,
	homeId: number | null = null
): Promise<UnifiConfig> {
	const currentConfig = await getUnifiConfig(homeId);

	const nextConfig: UnifiConfig = {
		url: normalizeUrl(input.url ?? currentConfig.url),
		username: (input.username ?? currentConfig.username).trim(),
		password: (input.password ?? currentConfig.password).trim(),
		site: (input.site ?? currentConfig.site).trim(),
		verifySsl: input.verifySsl ?? currentConfig.verifySsl,
		lastSyncAt: input.lastSyncAt ?? currentConfig.lastSyncAt,
		updatedAt: new Date().toISOString()
	};

	const path = await resolveConfigPath(homeId, 'unifi');
	await writeJsonConfig(path, nextConfig);
	_cache.delete(cacheKey(homeId));
	return nextConfig;
}

export async function updateLastSync(homeId: number | null = null): Promise<void> {
	const config = await getUnifiConfig(homeId);
	config.lastSyncAt = new Date().toISOString();
	const path = await resolveConfigPath(homeId, 'unifi');
	await writeJsonConfig(path, config);
	_cache.delete(cacheKey(homeId));
}
