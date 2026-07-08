/**
 * Historical energy data endpoint.
 * Returns time-series data plus aggregate totals for historical views.
 */

import type { RequestHandler } from './$types';
import { getHistory } from '$lib/server/ha-energy';
import { getEntityMappings } from '$lib/server/energy-mappings';
import { getSolarConfig } from '$lib/server/solar-config';
import type {
	TimeRange,
	CircuitHistory,
	HistoryPoint,
	HistoryResponse,
	HistoricalComparison
} from '$lib/types/energy';

const RANGE_DURATIONS: Record<Exclude<TimeRange, 'live'>, number> = {
	'1h': 60 * 60 * 1000,
	'24h': 24 * 60 * 60 * 1000,
	'7d': 7 * 24 * 60 * 60 * 1000,
	'30d': 30 * 24 * 60 * 60 * 1000
};

const RANGE_BUCKETS: Record<Exclude<TimeRange, 'live'>, number> = {
	'1h': 5 * 60 * 1000,
	'24h': 15 * 60 * 1000,
	'7d': 2 * 60 * 60 * 1000,
	'30d': 6 * 60 * 60 * 1000
};

type WindowMode = 'rolling' | 'today';

interface RangeWindow {
	start: Date;
	end: Date;
	startTime: string;
	endTime: string;
	durationMs: number;
}

interface SeriesSummary {
	points: HistoryPoint[];
	totalKwh: number;
	avgWatts: number;
	maxWatts: number;
}

function round(value: number, digits: number = 2): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function clampTime(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function normalizePoints(entries: { state: string; last_changed: string }[]): HistoryPoint[] {
	return entries
		.map((entry) => ({
			timestamp: entry.last_changed,
			watts: parseFloat(entry.state) || 0
		}))
		.filter((entry) => !Number.isNaN(Date.parse(entry.timestamp)))
		.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function summarizeSeries(points: HistoryPoint[], startMs: number, endMs: number): SeriesSummary {
	if (points.length === 0 || endMs <= startMs) {
		return { points, totalKwh: 0, avgWatts: 0, maxWatts: 0 };
	}

	let wattHours = 0;
	let maxWatts = 0;

	for (let i = 0; i < points.length; i += 1) {
		const point = points[i];
		const nextPoint = points[i + 1];
		const segmentStart = i === 0 ? startMs : clampTime(Date.parse(point.timestamp), startMs, endMs);
		const segmentEnd = nextPoint
			? clampTime(Date.parse(nextPoint.timestamp), startMs, endMs)
			: endMs;

		if (segmentEnd <= segmentStart) continue;

		const watts = Math.max(point.watts, 0);
		maxWatts = Math.max(maxWatts, watts);
		wattHours += watts * ((segmentEnd - segmentStart) / (60 * 60 * 1000));
	}

	const durationHours = (endMs - startMs) / (60 * 60 * 1000);
	const totalKwh = wattHours / 1000;
	const avgWatts = durationHours > 0 ? (totalKwh * 1000) / durationHours : 0;

	return {
		points,
		totalKwh: round(totalKwh),
		avgWatts: Math.round(avgWatts),
		maxWatts: Math.round(maxWatts)
	};
}

function buildWindow(range: Exclude<TimeRange, 'live'>, mode: WindowMode): RangeWindow {
	const end = new Date();
	let start: Date;

	if (mode === 'today') {
		start = new Date(end);
		start.setHours(0, 0, 0, 0);
	} else {
		start = new Date(end.getTime() - RANGE_DURATIONS[range]);
	}

	return {
		start,
		end,
		startTime: start.toISOString(),
		endTime: end.toISOString(),
		durationMs: end.getTime() - start.getTime()
	};
}

function buildPreviousWindow(window: RangeWindow): RangeWindow {
	const durationMs = window.durationMs;
	const end = new Date(window.start.getTime());
	const start = new Date(end.getTime() - durationMs);

	return {
		start,
		end,
		startTime: start.toISOString(),
		endTime: end.toISOString(),
		durationMs
	};
}

async function fetchSeriesSummary(
	entityId: string | null | undefined,
	window: RangeWindow,
	homeId?: number | null
): Promise<SeriesSummary | null> {
	if (!entityId) return null;

	try {
		const historyData = await getHistory(entityId, window.startTime, window.endTime, homeId);
		const points = normalizePoints(historyData[0] || []);
		return summarizeSeries(points, window.start.getTime(), window.end.getTime());
	} catch {
		return null;
	}
}

function buildComparison(
	currentExportKwh: number | null,
	previousExportKwh: number | null,
	currentConsumedKwh: number | null,
	previousConsumedKwh: number | null
): HistoricalComparison | null {
	const hasExportComparison = currentExportKwh != null && previousExportKwh != null;
	const delta = hasExportComparison ? round(currentExportKwh - previousExportKwh) : 0;
	const direction = !hasExportComparison ? 'flat' : delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat';
	const consumedDelta =
		currentConsumedKwh == null || previousConsumedKwh == null
			? null
			: round(currentConsumedKwh - previousConsumedKwh);
	const usageChangePercent =
		consumedDelta == null || !previousConsumedKwh
			? null
			: round((consumedDelta / previousConsumedKwh) * 100, 1);

	if (!hasExportComparison && usageChangePercent == null) return null;

	return {
		previousNetExportKwh: round(previousExportKwh ?? 0),
		deltaNetExportKwh: delta,
		direction,
		previousConsumedKwh: previousConsumedKwh == null ? null : round(previousConsumedKwh),
		deltaConsumedKwh: consumedDelta,
		usageChangePercent
	};
}

export const GET: RequestHandler = async ({ url }) => {
	const range = (url.searchParams.get('range') || '24h') as TimeRange;
	const circuitId = url.searchParams.get('circuit_id');
	const windowMode = url.searchParams.get('window') === 'today' ? 'today' : 'rolling';
	const homeId = url.searchParams.get('homeId') ? Number(url.searchParams.get('homeId')) : null;

	if (range === 'live' || !(range in RANGE_DURATIONS)) {
		return new Response(JSON.stringify({ error: 'Invalid range' }), { status: 400 });
	}

	const typedRange = range as Exclude<TimeRange, 'live'>;
	const window = buildWindow(typedRange, windowMode);
	const previousWindow = buildPreviousWindow(window);

	const mappings = await getEntityMappings();
	const targetMappings = circuitId
		? mappings.filter((mapping) => mapping.circuitId === Number(circuitId))
		: mappings;

	const circuitResults = await Promise.all(
		targetMappings.map(async (mapping): Promise<CircuitHistory | null> => {
			try {
				const historyData = await getHistory(mapping.entityId, window.startTime, window.endTime, homeId);
				const points = normalizePoints(historyData[0] || []);
				const summary = summarizeSeries(points, window.start.getTime(), window.end.getTime());

				return {
					circuitId: mapping.circuitId,
					circuitName: mapping.circuitName,
					panelName: mapping.panelName,
					points: summary.points,
					avgWatts: summary.avgWatts,
					maxWatts: summary.maxWatts,
					totalKwh: summary.totalKwh
				};
			} catch {
				return null;
			}
		})
	);

	const circuits = circuitResults
		.filter((circuit): circuit is CircuitHistory => circuit !== null)
		.sort((a, b) => b.totalKwh - a.totalKwh);

	const previousCircuitTotals = windowMode === 'today'
		? await Promise.all(
			targetMappings.map(async (mapping) => {
				const summary = await fetchSeriesSummary(mapping.entityId, previousWindow, homeId);
				return summary?.totalKwh ?? 0;
			})
		)
		: [];

	const bucketMs = RANGE_BUCKETS[typedRange];
	const totalBuckets = new Map<number, number>();

	for (const circuit of circuits) {
		for (const point of circuit.points) {
			const bucket = Math.floor(Date.parse(point.timestamp) / bucketMs) * bucketMs;
			totalBuckets.set(bucket, (totalBuckets.get(bucket) || 0) + point.watts);
		}
	}

	const totalPoints: HistoryPoint[] = [...totalBuckets.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([bucket, watts]) => ({
			timestamp: new Date(bucket).toISOString(),
			watts: Math.round(watts)
		}));

	const totalConsumedKwh = round(circuits.reduce((sum, circuit) => sum + circuit.totalKwh, 0));
	const previousConsumedKwh = previousCircuitTotals.length
		? round(previousCircuitTotals.reduce((sum, total) => sum + total, 0))
		: null;
	const maxConsumedWatts = circuits.length > 0 ? Math.max(...circuits.map((circuit) => circuit.maxWatts)) : 0;
	const durationHours = window.durationMs / (60 * 60 * 1000);
	const avgConsumedWatts = durationHours > 0 ? Math.round((totalConsumedKwh * 1000) / durationHours) : 0;
	const topConsumer = circuits[0]
		? {
			circuitId: circuits[0].circuitId,
			circuitName: circuits[0].circuitName,
			totalKwh: circuits[0].totalKwh
		}
		: null;

	const solarConfig = await getSolarConfig(homeId);
	const [solarSeries, gridImportSeries, gridExportSeries, previousGridExportSeries] = await Promise.all([
		fetchSeriesSummary(solarConfig.productionEntity, window, homeId),
		fetchSeriesSummary(solarConfig.gridImportEntity, window, homeId),
		fetchSeriesSummary(solarConfig.gridExportEntity, window, homeId),
		fetchSeriesSummary(solarConfig.gridExportEntity, previousWindow, homeId)
	]);

	const totalProducedKwh = solarSeries ? solarSeries.totalKwh : null;
	const avgProducedWatts = solarSeries ? solarSeries.avgWatts : null;
	const netImportKwh = gridImportSeries ? gridImportSeries.totalKwh : null;
	const netExportKwh = gridExportSeries ? gridExportSeries.totalKwh : null;
	const selfSufficiency =
		totalConsumedKwh > 0
			? round(1 - ((netImportKwh || 0) / totalConsumedKwh), 3)
			: null;

	const response: HistoryResponse = {
		range,
		window: windowMode,
		circuits,
		totalPoints,
		summary: {
			startTime: window.startTime,
			endTime: window.endTime,
			durationHours: round(durationHours, 3),
			totalConsumedKwh,
			avgConsumedWatts,
			maxConsumedWatts,
			totalProducedKwh,
			avgProducedWatts,
			netImportKwh,
			netExportKwh,
			selfSufficiency,
			topConsumer,
			comparison: buildComparison(
				netExportKwh,
				previousGridExportSeries?.totalKwh ?? null,
				totalConsumedKwh,
				previousConsumedKwh
			),
			partial: {
				solarUnavailable: solarSeries === null,
				gridUnavailable: gridImportSeries === null && gridExportSeries === null
			}
		}
	};

	return new Response(JSON.stringify(response), {
		headers: { 'Content-Type': 'application/json' }
	});
};
