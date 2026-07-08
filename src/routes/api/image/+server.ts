/**
 * Image proxy endpoint for offline caching.
 * Proxies NocoDB attachment images through a stable URL that the
 * Service Worker can cache. This avoids issues with signed/expiring URLs.
 * 
 * Usage: /api/image?path=<signedPath>
 */

import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const path = url.searchParams.get('path');
	if (!path) {
		return new Response('Missing path parameter', { status: 400 });
	}

	const nocodbUrl = env.NOCODB_URL || 'http://nocodb.socko.us';
	const imageUrl = `${nocodbUrl}/${path}`;

	try {
		const response = await fetch(imageUrl);
		if (!response.ok) {
			return new Response('Image not found', { status: response.status });
		}

		const contentType = response.headers.get('content-type') || 'image/jpeg';
		const body = await response.arrayBuffer();

		return new Response(body, {
			headers: {
				'content-type': contentType,
				'cache-control': 'public, max-age=86400, immutable'
			}
		});
	} catch (e) {
		return new Response('Failed to fetch image', { status: 502 });
	}
};
