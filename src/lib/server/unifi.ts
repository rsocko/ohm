import { getUnifiConfig } from './unifi-config';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UnifiDevice {
	mac: string;
	ip: string;
	name: string;
	model: string;
	model_in_lts: boolean;
	type: 'ugw' | 'usw' | 'uap' | 'udm' | 'uxg' | string;
	adopted: boolean;
	state: number; // 1 = connected
	version: string;
	port_table?: UnifiPort[];
	uplink?: { mac: string; type: string; uplink_mac?: string; uplink_remote_port?: number };
	system_stats?: { cpu: string; mem: string; uptime: string };
}

export interface UnifiPort {
	port_idx: number;
	name: string;
	media: string;
	speed: number;
	up: boolean;
	poe_caps?: number;
	poe_mode?: string;
	poe_enable?: boolean;
	poe_power?: string;
	poe_voltage?: string;
	poe_current?: string;
	poe_class?: string;
}

export interface UnifiClient {
	mac: string;
	ip: string;
	hostname?: string;
	name?: string;
	oui?: string;
	sw_mac?: string;
	sw_port?: number;
	network?: string;
	is_wired: boolean;
	is_guest: boolean;
	uptime: number;
	last_seen: number;
}

export interface PoePortStatus {
	port_idx: number;
	name: string;
	poe_enable: boolean;
	poe_mode: string;
	poe_power: number;
	poe_voltage: number;
	poe_current: number;
	poe_class: string;
	connected_mac?: string;
}

export interface SwitchPoeBudget {
	mac: string;
	name: string;
	model: string;
	max_power: number;
	total_power: number;
	port_count: number;
	poe_ports: PoePortStatus[];
}

// ─── Session Management ──────────────────────────────────────────────────────

// Per-home session cache: key is homeId (or 'default' for legacy)
const sessions = new Map<string, { cookie: string; loginUrl: string }>();

function sessionKey(homeId?: number | null): string {
	return homeId ? String(homeId) : 'default';
}

function getApiBase(url: string, site: string): string {
	// Cloud Gateway Max and UDM use /proxy/network/ prefix
	// Standalone controllers use direct /api/s/{site}/
	// We try /proxy/network/ first (most common for modern hardware)
	return `${url}/proxy/network/api/s/${site}`;
}

async function login(url: string, username: string, password: string, verifySsl: boolean): Promise<string> {
	const loginUrl = `${url}/api/auth/login`;

	const resp = await fetch(loginUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password }),
		...(verifySsl ? {} : { dispatcher: undefined }) // Note: SSL bypass handled via env
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`UniFi login failed (${resp.status}): ${text}`);
	}

	// Extract session cookie from Set-Cookie header
	const setCookie = resp.headers.getSetCookie?.() ?? [];
	const cookies = setCookie.length > 0
		? setCookie.join('; ')
		: resp.headers.get('set-cookie') || '';

	if (!cookies) {
		throw new Error('UniFi login succeeded but no session cookie returned');
	}

	// Parse cookie name=value pairs
	const cookieParts = cookies
		.split(/,(?=\s*\w+=)/)
		.map(c => c.split(';')[0].trim())
		.filter(Boolean);

	return cookieParts.join('; ');
}

async function ensureSession(homeId?: number | null): Promise<{ cookie: string; apiBase: string }> {
	const config = await getUnifiConfig(homeId);

	if (!config.url || !config.username || !config.password) {
		throw new Error('UniFi connection not configured. Set URL, username, and password in Settings.');
	}

	const key = sessionKey(homeId);
	const cached = sessions.get(key);
	if (cached && cached.loginUrl === config.url) {
		return { cookie: cached.cookie, apiBase: getApiBase(config.url, config.site) };
	}

	// Set NODE_TLS_REJECT_UNAUTHORIZED for self-signed certs
	if (!config.verifySsl) {
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	}

	const cookie = await login(config.url, config.username, config.password, config.verifySsl);
	sessions.set(key, { cookie, loginUrl: config.url });

	return { cookie, apiBase: getApiBase(config.url, config.site) };
}

function clearSession(homeId?: number | null): void {
	sessions.delete(sessionKey(homeId));
}

// ─── API Helpers ─────────────────────────────────────────────────────────────

async function unifiFetch<T>(path: string, homeId?: number | null, retry = true): Promise<T> {
	const { cookie, apiBase } = await ensureSession(homeId);
	const url = `${apiBase}${path}`;

	const resp = await fetch(url, {
		headers: { Cookie: cookie }
	});

	// Handle 401 with one retry after re-auth
	if (resp.status === 401 && retry) {
		clearSession(homeId);
		return unifiFetch<T>(path, homeId, false);
	}

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`UniFi API error (${resp.status}): ${text}`);
	}

	const json = await resp.json();
	return (json as { data?: T }).data ?? (json as T);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Test connection and return basic info. */
export async function testConnection(homeId?: number | null): Promise<{
	success: boolean;
	deviceCount: number;
	siteName: string;
	controllerVersion: string;
	message: string;
}> {
	try {
		const devices = await getDevices(homeId);
		const config = await getUnifiConfig(homeId);
		return {
			success: true,
			deviceCount: devices.length,
			siteName: config.site,
			controllerVersion: devices[0]?.version || 'unknown',
			message: `Connected. Found ${devices.length} device(s).`
		};
	} catch (error) {
		clearSession(homeId);
		return {
			success: false,
			deviceCount: 0,
			siteName: '',
			controllerVersion: '',
			message: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}

/** Fetch all adopted UniFi devices (APs, switches, gateways). */
export async function getDevices(homeId?: number | null): Promise<UnifiDevice[]> {
	return unifiFetch<UnifiDevice[]>('/stat/device', homeId);
}

/** Fetch a single device by MAC address. */
export async function getDevice(mac: string, homeId?: number | null): Promise<UnifiDevice | null> {
	const devices = await unifiFetch<UnifiDevice[]>(`/stat/device/${mac.toLowerCase()}`, homeId);
	return devices[0] || null;
}

/** Fetch all connected clients (wired + wireless). */
export async function getClients(homeId?: number | null): Promise<UnifiClient[]> {
	return unifiFetch<UnifiClient[]>('/stat/sta', homeId);
}

/** Get POE port status for a specific switch. */
export async function getPoeBudget(switchMac: string, homeId?: number | null): Promise<SwitchPoeBudget | null> {
	const device = await getDevice(switchMac, homeId);
	if (!device || !device.port_table) return null;

	const clients = await getClients(homeId);
	const clientsByPort = new Map<number, UnifiClient>();

	for (const client of clients) {
		if (client.sw_mac?.toLowerCase() === switchMac.toLowerCase() && client.sw_port) {
			clientsByPort.set(client.sw_port, client);
		}
	}

	const poePorts: PoePortStatus[] = device.port_table
		.filter(p => p.poe_caps && p.poe_caps > 0)
		.map(p => ({
			port_idx: p.port_idx,
			name: p.name,
			poe_enable: p.poe_enable ?? false,
			poe_mode: p.poe_mode || 'off',
			poe_power: parseFloat(p.poe_power || '0'),
			poe_voltage: parseFloat(p.poe_voltage || '0'),
			poe_current: parseFloat(p.poe_current || '0'),
			poe_class: p.poe_class || 'Unknown',
			connected_mac: clientsByPort.get(p.port_idx)?.mac
		}));

	const totalPower = poePorts.reduce((sum, p) => sum + p.poe_power, 0);

	// Estimate max POE budget based on switch model
	const maxPower = estimateMaxPoeBudget(device.model);

	return {
		mac: device.mac,
		name: device.name,
		model: device.model,
		max_power: maxPower,
		total_power: Math.round(totalPower * 100) / 100,
		port_count: device.port_table.length,
		poe_ports: poePorts
	};
}

/** List available sites (for site selector in settings). */
export async function getSites(homeId?: number | null): Promise<Array<{ name: string; desc: string }>> {
	const config = await getUnifiConfig(homeId);
	if (!config.url || !config.username || !config.password) return [];

	const { cookie } = await ensureSession(homeId);
	const resp = await fetch(`${config.url}/proxy/network/api/self/sites`, {
		headers: { Cookie: cookie }
	});

	if (!resp.ok) return [];
	const json = await resp.json();
	return ((json as { data?: Array<{ name: string; desc: string }> }).data ?? []);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function estimateMaxPoeBudget(model: string): number {
	// Known UniFi switch POE budgets (watts)
	const budgets: Record<string, number> = {
		'US-8-60W': 60,
		'US-8-150W': 150,
		'US-16-150W': 150,
		'US-24-250W': 250,
		'US-24-500W': 500,
		'US-48-500W': 500,
		'US-48-750W': 750,
		'USW-Lite-8-PoE': 52,
		'USW-Lite-16-PoE': 45,
		'USW-24-PoE': 95,
		'USW-Pro-24-PoE': 400,
		'USW-Pro-48-PoE': 600,
		'USW-Enterprise-24-PoE': 400,
		'USW-Enterprise-48-PoE': 720,
		'USW-Ultra': 42
	};

	return budgets[model] || 0;
}

/** Map UniFi device type to NocoDB Network_Role. */
export function mapDeviceTypeToRole(type: string): string {
	const mapping: Record<string, string> = {
		ugw: 'Gateway',
		udm: 'Gateway',
		uxg: 'Gateway',
		usw: 'Switch',
		uap: 'Access Point'
	};
	return mapping[type] || 'Client Device';
}

/** Infer Power_Source from POE status. */
export function inferPowerSource(port?: UnifiPort): string {
	if (!port || !port.poe_enable) return 'Circuit';
	return 'POE';
}
