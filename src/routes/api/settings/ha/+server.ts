import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHAConfig, getHAConfigSafe, saveHAConfig } from '$lib/server/ha-config';

function getHomeId(url: URL): number | null {
	const raw = url.searchParams.get('homeId');
	return raw ? Number(raw) : null;
}

/**
 * GET /api/settings/ha?homeId=123 - Get current HA config (safe, no token exposed)
 */
export const GET: RequestHandler = async ({ url }) => {
	const homeId = getHomeId(url);
	const config = await getHAConfigSafe(homeId);
	return json(config);
};

/**
 * POST /api/settings/ha - Save HA config from UI
 * Body: { url?, token?, enabled?, homeId? }
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const body = await request.json();
	const homeId = body.homeId ?? getHomeId(url);
	const saved = await saveHAConfig(body, homeId);

	const { token, ...safe } = saved;
	return json({ ...safe, hasToken: Boolean(token) });
};

/**
 * PUT /api/settings/ha - Test connection (uses saved config, ignores enabled toggle)
 */
export const PUT: RequestHandler = async ({ request, url }) => {
	const body = await request.json();
	const homeId = body.homeId ?? getHomeId(url);

	// Use provided values or fall back to saved config
	const savedConfig = await getHAConfig(homeId);
	const testUrl = (body.url || savedConfig.url || '').replace(/\/+$/, '');
	const testToken = body.token || savedConfig.token || '';

	if (!testUrl || !testToken) {
		return json({ connected: false, error: 'URL and token are required. Save your configuration first.' });
	}

	try {
		const resp = await fetch(`${testUrl}/api/`, {
			headers: {
				'Authorization': 'Bearer ' + testToken,
				'Content-Type': 'application/json'
			}
		});
		if (!resp.ok) {
			return json({ connected: false, error: `HTTP ${resp.status}: ${resp.statusText}` });
		}
		const data = await resp.json();
		return json({ connected: true, version: data.version, location_name: data.location_name });
	} catch (err) {
		return json({
			connected: false,
			error: err instanceof Error ? err.message : 'Connection failed'
		});
	}
};