/**
 * SSE endpoint for live energy readings.
 * Streams real-time power data from HA to the client.
 */

import type { RequestHandler } from './$types';
import {
	getCircuitReadings,
	getSolarReading,
	calculateCost,
	checkConnection
} from '$lib/server/ha-energy';
import { getEntityMappings } from '$lib/server/energy-mappings';
import type { LiveSSEData, CapacityAlert } from '$lib/types/energy';

export const GET: RequestHandler = async ({ url }) => {
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;
	const encoder = new TextEncoder();
	let intervalId: ReturnType<typeof setInterval> | null = null;
	let previousReadings = new Map<string, number>();

	// Cache mappings per-connection (refresh every 5 minutes)
	let cachedMappings: Awaited<ReturnType<typeof getEntityMappings>> | null = null;
	let lastMappingRefresh = 0;
	const MAPPING_REFRESH_MS = 5 * 60 * 1000;

	const stream = new ReadableStream({
		async start(controller) {
			// Send retry interval
			controller.enqueue(encoder.encode('retry: 3000\n\n'));

			const connected = await checkConnection(homeId);
			if (!connected) {
				controller.enqueue(
					encoder.encode(`event: error\ndata: ${JSON.stringify({ message: 'HA unreachable' })}\n\n`)
				);
				controller.close();
				return;
			}

			let closed = false;

			async function sendUpdate() {
				if (closed) return;
				try {
					const now = Date.now();
					if (!cachedMappings || now - lastMappingRefresh > MAPPING_REFRESH_MS) {
						cachedMappings = await getEntityMappings();
						lastMappingRefresh = now;
					}
					const circuits = await getCircuitReadings(cachedMappings, previousReadings, homeId);
						const solar = await getSolarReading(homeId);

					// Update previous readings for trend calculation
					previousReadings = new Map(circuits.map((c) => [c.entityId, c.watts]));

					const totalWatts = circuits.reduce((sum, c) => sum + c.watts, 0);

					// Calculate net solar
					if (solar) {
						solar.netWatts = totalWatts - solar.production;
					}

					const cost = calculateCost(totalWatts);

					// Generate capacity alerts
					const alerts: CapacityAlert[] = circuits
						.filter((c) => c.capacityPercent >= 60)
						.map((c) => ({
							circuitId: c.circuitId,
							circuitName: c.circuitName,
							severity: c.capacityPercent >= 80 ? 'critical' : 'warning',
							currentAmps: c.watts / (cachedMappings!.find((m) => m.circuitId === c.circuitId)?.voltage || 120),
							ratedAmps: cachedMappings!.find((m) => m.circuitId === c.circuitId)?.ampRating || 20,
							percent: c.capacityPercent,
							message: `${c.circuitName} at ${c.capacityPercent}% capacity`
						}));

					const data: LiveSSEData = {
						total: totalWatts,
						circuits,
						solar,
						cost,
						alerts,
						timestamp: new Date().toISOString()
					};

					controller.enqueue(
						encoder.encode(`event: power\ndata: ${JSON.stringify(data)}\n\n`)
					);
				} catch (err) {
					if (closed) return;
					try {
						controller.enqueue(
							encoder.encode(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`)
						);
					} catch { /* controller already closed */ }
				}
			}

			// Send initial snapshot
			await sendUpdate();

			// Then update every two seconds
			intervalId = setInterval(sendUpdate, 2000);
		},
		cancel() {
			if (intervalId) clearInterval(intervalId);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
