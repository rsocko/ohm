/**
 * SSE endpoint for live energy readings.
 * Streams real-time power data from HA via WebSocket bridge (with REST fallback).
 */

import type { RequestHandler } from './$types';
import { addSSEClient, getStatus } from '$lib/server/ha-websocket-bridge';
import { checkConnection } from '$lib/server/ha-energy';
import type { LiveSSEData } from '$lib/types/energy';

export const GET: RequestHandler = async ({ url }) => {
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;
	const encoder = new TextEncoder();
	let unsubscribe: (() => void) | null = null;

	const stream = new ReadableStream({
		async start(controller) {
			// Send retry interval for auto-reconnect
			controller.enqueue(encoder.encode('retry: 3000\n\n'));

			const connected = await checkConnection(homeId);
			if (!connected) {
				controller.enqueue(
					encoder.encode(`event: error\ndata: ${JSON.stringify({ message: 'HA unreachable' })}\n\n`)
				);
				controller.close();
				return;
			}

			// Send current bridge status
			const status = getStatus();
			controller.enqueue(
				encoder.encode(`event: status\ndata: ${JSON.stringify({ mode: status.mode, wsConnected: status.wsConnected })}\n\n`)
			);

			// Register with the WebSocket-SSE bridge
			unsubscribe = addSSEClient((data: LiveSSEData) => {
				try {
					controller.enqueue(
						encoder.encode(`event: power\ndata: ${JSON.stringify(data)}\n\n`)
					);
				} catch {
					// Client disconnected — cleanup will happen in cancel()
				}
			}, homeId);
		},
		cancel() {
			if (unsubscribe) {
				unsubscribe();
				unsubscribe = null;
			}
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
