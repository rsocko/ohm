<script lang="ts">
	/**
	 * Combined overview chart — dual-line trend showing production + consumption
	 * over time. Uses native SVG polylines for a zero-dep, lightweight chart.
	 */
	import type { HistoryPoint } from '$lib/types/energy';

	interface Props {
		/** Consumption data points (today's total load) */
		consumptionPoints: HistoryPoint[];
		/** Solar production data points */
		productionPoints: HistoryPoint[];
		/** Chart height in px */
		height?: number;
	}

	let { consumptionPoints, productionPoints, height = 160 }: Props = $props();

	const WIDTH = 400;
	const PADDING = { top: 16, right: 12, bottom: 28, left: 44 };

	const plotW = WIDTH - PADDING.left - PADDING.right;
	const plotH = height - PADDING.top - PADDING.bottom;

	// Merge timestamps from both datasets to determine time range
	const timeRange = $derived.by(() => {
		const allTimes: number[] = [];
		for (const p of consumptionPoints) allTimes.push(new Date(p.timestamp).getTime());
		for (const p of productionPoints) allTimes.push(new Date(p.timestamp).getTime());
		if (allTimes.length < 2) return { min: 0, max: 1 };
		return { min: Math.min(...allTimes), max: Math.max(...allTimes) };
	});

	const maxWatts = $derived.by(() => {
		let max = 100;
		for (const p of consumptionPoints) if (p.watts > max) max = p.watts;
		for (const p of productionPoints) if (p.watts > max) max = p.watts;
		return max * 1.1; // 10% headroom
	});

	function toPolyline(points: HistoryPoint[]): string {
		if (points.length < 2) return '';
		const { min, max } = timeRange;
		const span = max - min || 1;
		return points
			.map((p) => {
				const t = new Date(p.timestamp).getTime();
				const x = PADDING.left + ((t - min) / span) * plotW;
				const y = PADDING.top + plotH - (p.watts / maxWatts) * plotH;
				return `${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	}

	function toFillPolygon(points: HistoryPoint[]): string {
		if (points.length < 2) return '';
		const baseline = PADDING.top + plotH;
		const { min, max } = timeRange;
		const span = max - min || 1;
		const coords = points.map((p) => {
			const t = new Date(p.timestamp).getTime();
			const x = PADDING.left + ((t - min) / span) * plotW;
			const y = PADDING.top + plotH - (p.watts / maxWatts) * plotH;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});
		const firstX = (PADDING.left + ((new Date(points[0].timestamp).getTime() - min) / span) * plotW).toFixed(1);
		const lastX = (PADDING.left + ((new Date(points[points.length - 1].timestamp).getTime() - min) / span) * plotW).toFixed(1);
		return `${firstX},${baseline} ${coords.join(' ')} ${lastX},${baseline}`;
	}

	const consumptionLine = $derived(toPolyline(consumptionPoints));
	const productionLine = $derived(toPolyline(productionPoints));
	const consumptionFill = $derived(toFillPolygon(consumptionPoints));
	const productionFill = $derived(toFillPolygon(productionPoints));

	// Y-axis tick marks (4 ticks)
	const yTicks = $derived.by(() => {
		const ticks: { y: number; label: string }[] = [];
		const steps = 4;
		for (let i = 0; i <= steps; i++) {
			const watts = (maxWatts / steps) * i;
			const y = PADDING.top + plotH - (watts / maxWatts) * plotH;
			const label = watts >= 1000 ? `${(watts / 1000).toFixed(1)}k` : `${Math.round(watts)}`;
			ticks.push({ y, label });
		}
		return ticks;
	});

	// X-axis time labels (up to 5)
	const xTicks = $derived.by(() => {
		const { min, max } = timeRange;
		const span = max - min;
		if (span <= 0) return [];
		const count = 5;
		const ticks: { x: number; label: string }[] = [];
		for (let i = 0; i <= count; i++) {
			const t = min + (span / count) * i;
			const x = PADDING.left + (((t - min) / span) * plotW);
			const d = new Date(t);
			ticks.push({ x, label: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) });
		}
		return ticks;
	});

	const hasData = $derived(consumptionPoints.length >= 2 || productionPoints.length >= 2);
</script>

<div class="rounded-xl border border-slate-700/40 bg-slate-950/60 p-4">
	<div class="mb-3 flex items-center justify-between">
		<div>
			<h3 class="text-sm font-semibold text-white">Today's Overview</h3>
			<p class="text-[11px] text-slate-400">Production vs consumption</p>
		</div>
		<div class="flex items-center gap-4 text-[11px]">
			<span class="flex items-center gap-1.5">
				<span class="inline-block h-2 w-4 rounded-sm bg-amber-400"></span>
				<span class="text-slate-400">Solar</span>
			</span>
			<span class="flex items-center gap-1.5">
				<span class="inline-block h-2 w-4 rounded-sm bg-indigo-400"></span>
				<span class="text-slate-400">Consumption</span>
			</span>
		</div>
	</div>

	{#if hasData}
		<svg viewBox="0 0 {WIDTH} {height}" class="w-full" preserveAspectRatio="xMidYMid meet">
			<!-- Grid lines -->
			{#each yTicks as tick}
				<line
					x1={PADDING.left} y1={tick.y}
					x2={WIDTH - PADDING.right} y2={tick.y}
					stroke="rgba(148,163,184,0.08)" stroke-width="1"
				/>
				<text x={PADDING.left - 6} y={tick.y + 3} text-anchor="end"
					fill="#64748b" font-size="9" font-weight="500">{tick.label}</text>
			{/each}

			<!-- X-axis labels -->
			{#each xTicks as tick}
				<text x={tick.x} y={height - 4} text-anchor="middle"
					fill="#64748b" font-size="9" font-weight="500">{tick.label}</text>
			{/each}

			<!-- Production (solar) area + line -->
			{#if productionFill}
				<polygon points={productionFill} fill="rgba(251,191,36,0.1)" />
				<polyline points={productionLine} fill="none"
					stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
			{/if}

			<!-- Consumption area + line -->
			{#if consumptionFill}
				<polygon points={consumptionFill} fill="rgba(99,102,241,0.1)" />
				<polyline points={consumptionLine} fill="none"
					stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
			{/if}
		</svg>
	{:else}
		<div class="flex items-center justify-center py-8 text-sm text-slate-500">
			Chart data will appear as the day progresses
		</div>
	{/if}
</div>
