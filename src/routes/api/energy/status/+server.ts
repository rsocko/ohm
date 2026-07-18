/**
 * Energy bridge status endpoint.
 * Returns current WebSocket connection status for "HA Offline" badge
 * and SSE stream for real-time status updates.
 */

import type { RequestHandler } from './$types';
import { getStatus, addStatusClient } from '$lib/server/ha-websocket-bridge';

/** GET /api/energy/status — returns current status as JSON */
export const GET: RequestHandler = async ({ url }) => {
	const stream = url.searchParams.get('stream') === 'true';

	if (!stream) {
		return new Response(JSON.stringify(getStatus()), {
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// SSE stream for real-time status updates
	const encoder = new TextEncoder();
	let unsubscribe: (() => void) | null = null;

	const readable = new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode('retry: 5000\n\n'));

			unsubscribe = addStatusClient((status) => {
				try {
					controller.enqueue(
						encoder.encode(`event: status\ndata: ${JSON.stringify(status)}\n\n`)
					);
				} catch { /* client disconnected */ }
			});
		},
		cancel() {
			if (unsubscribe) {
				unsubscribe();
				unsubscribe = null;
			}
		}
	});

	return new Response(readable, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
