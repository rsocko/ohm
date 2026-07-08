import type { HistoricalSummary, HistoryPoint } from '$lib/types/energy';

export type EnergyInsightTone = 'solar' | 'consumption' | 'comparison' | 'efficiency';

export interface EnergyInsightItem {
	id: string;
	title: string;
	description: string;
	icon: string;
	tone: EnergyInsightTone;
}

interface BuildEnergyInsightsOptions {
	todaySummary: HistoricalSummary | null;
	todayTotalPoints?: HistoryPoint[] | null;
	solarHistory?: HistoryPoint[] | null;
	activeCircuitCount?: number | null;
}

function formatKwh(value: number): string {
	return `${value.toFixed(value >= 10 ? 1 : 2)} kWh`;
}

function formatKw(value: number): string {
	return `${(value / 1000).toFixed(value >= 1000 ? 1 : 2)} kW`;
}

function formatPercent(value: number): string {
	return `${Math.abs(value).toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`;
}

function formatHourWindow(startHour: number): string {
	const start = new Date();
	start.setHours(startHour, 0, 0, 0);
	const end = new Date(start);
	end.setHours(startHour + 1, 0, 0, 0);
	return `${start.toLocaleTimeString([], { hour: 'numeric' })}-${end.toLocaleTimeString([], { hour: 'numeric' })}`;
}

function getPeakUsageWindow(points: HistoryPoint[] | null | undefined): string | null {
	if (!points?.length) return null;

	const hourlyTotals = new Map<number, number>();

	for (const point of points) {
		const stamp = new Date(point.timestamp);
		const hour = stamp.getHours();
		hourlyTotals.set(hour, (hourlyTotals.get(hour) || 0) + Math.max(point.watts, 0));
	}

	let bestHour: number | null = null;
	let bestTotal = -1;

	for (const [hour, total] of hourlyTotals.entries()) {
		if (total > bestTotal) {
			bestHour = hour;
			bestTotal = total;
		}
	}

	return bestHour == null ? null : formatHourWindow(bestHour);
}

function getSolarPeak(points: HistoryPoint[] | null | undefined): { watts: number; timeLabel: string } | null {
	if (!points?.length) return null;

	let peak: HistoryPoint | null = null;
	for (const point of points) {
		if (!peak || point.watts > peak.watts) {
			peak = point;
		}
	}

	if (!peak || peak.watts <= 0) return null;

	return {
		watts: peak.watts,
		timeLabel: new Date(peak.timestamp).toLocaleTimeString([], {
			hour: 'numeric',
			minute: '2-digit'
		})
	};
}

export function buildEnergyInsights({
	todaySummary,
	todayTotalPoints,
	solarHistory,
	activeCircuitCount
}: BuildEnergyInsightsOptions): EnergyInsightItem[] {
	const items: EnergyInsightItem[] = [];

	if (todaySummary?.comparison?.usageChangePercent != null) {
		const percent = todaySummary.comparison.usageChangePercent;
		const direction = percent >= 0 ? 'up' : 'down';
		const deltaKwh = todaySummary.comparison.deltaConsumedKwh;
		const deltaLabel =
			deltaKwh == null || Math.abs(deltaKwh) < 0.01 ? '' : ` (${formatKwh(Math.abs(deltaKwh))})`;

		items.push({
			id: 'usage-vs-yesterday',
			title: 'Usage vs yesterday',
			description:
				Math.abs(percent) < 1
					? 'Usage is tracking nearly flat versus yesterday.'
					: `Usage is ${direction} ${formatPercent(percent)} vs yesterday${deltaLabel}.`,
			icon: percent >= 0 ? 'mdi:trending-up' : 'mdi:trending-down',
			tone: 'comparison'
		});
	}

	const peakWindow = getPeakUsageWindow(todayTotalPoints);
	if (peakWindow) {
		items.push({
			id: 'peak-usage-window',
			title: 'Peak usage window',
			description: `Highest consumption landed between ${peakWindow}.`,
			icon: 'mdi:clock-time-four-outline',
			tone: 'consumption'
		});
	}

	const solarPeak = getSolarPeak(solarHistory);
	if (solarPeak) {
		items.push({
			id: 'solar-peak',
			title: 'Solar peak',
			description: `${formatKw(solarPeak.watts)} at ${solarPeak.timeLabel}.`,
			icon: 'mdi:white-balance-sunny',
			tone: 'solar'
		});
	}

	if (activeCircuitCount != null) {
		items.push({
			id: 'active-circuits',
			title: 'Active circuits',
			description: `${activeCircuitCount} circuit${activeCircuitCount === 1 ? '' : 's'} currently drawing power.`,
			icon: 'mdi:flash-outline',
			tone: 'efficiency'
		});
	}

	if (todaySummary?.selfSufficiency != null) {
		items.push({
			id: 'solar-coverage',
			title: 'Solar coverage',
			description: `Solar covered ${Math.round(todaySummary.selfSufficiency * 100)}% of today’s consumption.`,
			icon: 'mdi:solar-power',
			tone: 'solar'
		});
	}

	if (todaySummary?.topConsumer) {
		const sharePercent = todaySummary.totalConsumedKwh > 0
			? (todaySummary.topConsumer.totalKwh / todaySummary.totalConsumedKwh) * 100
			: 0;
		const shareLabel = sharePercent >= 1 ? ` (${Math.round(sharePercent)}% of total)` : '';
		items.push({
			id: 'top-consumer',
			title: 'Top consumer',
			description: `${todaySummary.topConsumer.circuitName} used ${formatKwh(todaySummary.topConsumer.totalKwh)} today${shareLabel}.`,
			icon: 'mdi:home-lightning-bolt',
			tone: 'consumption'
		});
	}

	return items;
}
