import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDevices, mapDeviceTypeToRole } from '$lib/server/unifi';

export const GET: RequestHandler = async ({ url }) => {
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;
	try {
		const devices = await getDevices(homeId);

		const mapped = devices.map((d) => ({
			mac: d.mac,
			ip: d.ip,
			name: d.name,
			model: d.model,
			type: d.type,
			role: mapDeviceTypeToRole(d.type),
			state: d.state === 1 ? 'online' : 'offline',
			hasPoe: d.port_table?.some((p) => p.poe_caps && p.poe_caps > 0) ?? false,
			portCount: d.port_table?.length ?? 0,
			uplink_mac: d.uplink?.mac || null
		}));

		return json({ devices: mapped });
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to fetch devices' },
			{ status: 502 }
		);
	}
};
