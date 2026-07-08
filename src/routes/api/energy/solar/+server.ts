/**
 * Solar energy endpoint.
 * Returns current production, daily/lifetime totals, grid flow, and history.
 */

import type { RequestHandler } from './$types';
import { getSolarReading, getSolarHistory } from '$lib/server/ha-energy';
import { getSolarConfig } from '$lib/server/solar-config';
import type { SolarReading, SolarSummary, SolarResponse, HistoryPoint, TimeRange } from '$lib/types/energy';

const RANGE_HOURS: Record<Exclude<TimeRange, 'live'>, number> = {
	'1h': 1,
	'24h': 24,
	'7d': 24 * 7,
	'30d': 24 * 30
};

export const GET: RequestHandler = async ({ url }) => {
	const range = (url.searchParams.get('range') || '24h') as TimeRange;
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;

	try {
		const [solarReading, config] = await Promise.all([
			getSolarReading(homeId),
			getSolarConfig(homeId),
		]);

		if (!solarReading) {
			return new Response(
				JSON.stringify({ error: 'Solar entity not available. Configure in Settings → Solar.' }),
				{ status: 503 }
			);
		}

		const current: SolarReading = solarReading;

		const summary: SolarSummary = {
			currentProduction: solarReading.production,
			todayKwh: solarReading.todayWh / 1000,
			monthKwh: 0, // Would need longer history aggregation
			lifetimeKwh: solarReading.lifetimeKwh,
			selfConsumptionRatio: solarReading.production > 0 && solarReading.gridExportW >= 0
				? Math.max(0, 1 - (solarReading.gridExportW / solarReading.production))
				: 0,
		};

		// Get production history for sparkline
		const hours = range === 'live' ? 24 : RANGE_HOURS[range] || 24;
		const historyRaw = await getSolarHistory(hours, homeId);
		const history: HistoryPoint[] = historyRaw.map((p) => ({
			timestamp: p.timestamp,
			watts: p.watts,
		}));

		const response: SolarResponse = { current, summary, history };

		return new Response(JSON.stringify(response), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		return new Response(
			JSON.stringify({ error: `Solar data unavailable: ${err}` }),
			{ status: 503 }
		);
	}
};
