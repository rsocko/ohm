import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClients } from '$lib/server/unifi';

export const GET: RequestHandler = async ({ url }) => {
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;
	try {
		const wiredOnly = url.searchParams.get('wired') === 'true';
		let clients = await getClients(homeId);

		if (wiredOnly) {
			clients = clients.filter((c) => c.is_wired);
		}

		const mapped = clients.map((c) => ({
			mac: c.mac,
			ip: c.ip,
			name: c.name || c.hostname || c.oui || c.mac,
			hostname: c.hostname,
			switch_mac: c.sw_mac || null,
			switch_port: c.sw_port || null,
			network: c.network,
			is_wired: c.is_wired,
			is_guest: c.is_guest,
			uptime: c.uptime,
			last_seen: c.last_seen
		}));

		return json({ clients: mapped });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to fetch clients' },
			{ status: 502 }
		);
	}
};
