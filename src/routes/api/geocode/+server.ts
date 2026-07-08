import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { NOCODB_URL, NOCODB_API_TOKEN } from '$env/static/private';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const HOME_TABLE_ID = 'm00j4ejurglc7az';

interface NominatimResult {
	lat: string;
	lon: string;
	display_name: string;
}

/**
 * POST /api/geocode
 * Body: { homeId: number, address: string, city: string, state: string, zip: string }
 * Geocodes the address via Nominatim and writes Lat/Lng back to NocoDB.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { homeId, address, city, state, zip } = await request.json();

	if (!homeId) {
		return json({ error: 'homeId is required' }, { status: 400 });
	}

	// Build query string from available fields
	const parts = [address, city, state, zip].filter(Boolean);
	if (parts.length === 0) {
		return json({ error: 'No address fields provided' }, { status: 400 });
	}
	const q = parts.join(', ');

	try {
		// Query OpenStreetMap Nominatim (free, no API key needed)
		const params = new URLSearchParams({
			q,
			format: 'json',
			limit: '1',
			countrycodes: 'us'
		});

		const resp = await fetch(`${NOMINATIM_URL}?${params}`, {
			headers: {
				'User-Agent': 'ElectricalConfigApp/1.0 (home-automation project)'
			}
		});

		if (!resp.ok) {
			return json({ error: `Nominatim returned ${resp.status}` }, { status: 502 });
		}

		const results: NominatimResult[] = await resp.json();
		if (!results.length) {
			return json({ error: 'No geocoding results found for address', query: q }, { status: 404 });
		}

		const lat = parseFloat(results[0].lat);
		const lng = parseFloat(results[0].lon);

		// Write back to NocoDB
		const patchResp = await fetch(`${NOCODB_URL}/api/v2/tables/${HOME_TABLE_ID}/records`, {
			method: 'PATCH',
			headers: {
				'xc-token': NOCODB_API_TOKEN,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify([{ Id: homeId, Latitude: lat, Longitude: lng }])
		});

		if (!patchResp.ok) {
			const err = await patchResp.text();
			return json({ error: 'Failed to write coordinates to NocoDB', details: err }, { status: 500 });
		}

		return json({
			success: true,
			lat,
			lng,
			display_name: results[0].display_name,
			query: q
		});
	} catch (e) {
		return json({ error: 'Geocoding failed', details: String(e) }, { status: 500 });
	}
};
