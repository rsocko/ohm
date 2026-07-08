<script lang="ts">
	import type { CostEstimate } from '$lib/types/energy';

	let { totalWatts, rate, cost }: { totalWatts: number; rate: number; cost: CostEstimate | null } = $props();

	// Generate a simple sparkline path from recent values
	let history: number[] = $state([]);
	const MAX_POINTS = 60;
	let prevWatts = $state(-1);

	$effect(() => {
		const w = totalWatts;
		if (w !== prevWatts) {
			prevWatts = w;
			history.push(w);
			if (history.length > MAX_POINTS) {
				history.splice(0, history.length - MAX_POINTS);
			}
		}
	});

	function sparklinePath(values: number[], width: number, height: number): string {
		if (values.length < 2) return '';
		const max = Math.max(...values, 1);
		const min = Math.min(...values, 0);
		const range = max - min || 1;
		const step = width / (values.length - 1);

		return values
			.map((v, i) => {
				const x = i * step;
				const y = height - ((v - min) / range) * height;
				return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
			})
			.join(' ');
	}

	function sparklineArea(values: number[], width: number, height: number): string {
		const line = sparklinePath(values, width, height);
		if (!line) return '';
		return `${line} L${width} ${height} L0 ${height} Z`;
	}

	const sparkPath = $derived.by(() => sparklinePath(history, 320, 54));
	const sparkArea = $derived.by(() => sparklineArea(history, 320, 54));
</script>

<div class="rounded-3xl bg-gradient-to-b from-slate-800/96 to-slate-800/88 p-5 shadow-[0_18px_42px_rgba(2,6,23,0.34),inset_0_1px_0_rgba(255,255,255,0.04)]">
	<div class="flex items-start justify-between gap-4">
		<div>
			<p class="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Total power</p>
			<div class="text-[40px] font-bold leading-none tracking-tight text-white" style="font-variant-numeric: tabular-nums;">
				{totalWatts.toLocaleString()} <span class="text-[21px] text-slate-300">W</span>
			</div>
		</div>
		<div class="rounded-2xl bg-sky-400/10 px-3 py-2 text-right shadow-[inset_0_0_0_1px_rgba(125,211,252,0.14)]">
			<div class="text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-300">Rate</div>
			<div class="mt-1 text-sm font-semibold text-white">${rate.toFixed(3)}/kWh</div>
		</div>
	</div>

	<!-- Sparkline -->
	{#if history.length > 1}
		<div class="mt-4 h-[54px] overflow-hidden rounded-2xl bg-gradient-to-b from-slate-950/40 to-slate-950/12 p-2 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.05)]">
			<svg viewBox="0 0 320 54" class="h-full w-full" preserveAspectRatio="none">
				<defs>
					<linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
						<stop offset="0%" stop-color="rgba(56,189,248,0.28)" />
						<stop offset="100%" stop-color="rgba(56,189,248,0)" />
					</linearGradient>
				</defs>
				<path d={sparkArea} fill="url(#sparkFill)" />
				<path d={sparkPath} fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" />
			</svg>
		</div>
	{/if}

	<!-- Cost estimate -->
	{#if cost}
		<div class="mt-3 flex items-center justify-between rounded-2xl bg-slate-950/25 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.06)]">
			<span class="text-sm text-slate-400">Daily cost estimate</span>
			<span class="text-sm font-semibold text-slate-100">~${cost.dailyCost.toFixed(2)}/day at current rate</span>
		</div>
	{/if}
</div>
