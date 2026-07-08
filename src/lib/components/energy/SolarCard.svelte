<script lang="ts">
	import Icon from '@iconify/svelte';
	import type { SolarReading, HistoryPoint } from '$lib/types/energy';

	let { solar, history = [] }: { solar: SolarReading | null; history?: HistoryPoint[] } = $props();

	const netLabel = $derived.by(() => {
		if (!solar) return '';
		// Use grid entities if available, otherwise fall back to netWatts
		if (solar.gridExportW > 50) return `Exporting ${solar.gridExportW.toLocaleString()}W to grid`;
		if (solar.gridImportW > 50) return `Importing ${solar.gridImportW.toLocaleString()}W from grid`;
		if (solar.netWatts > 50) return `Importing ${solar.netWatts.toLocaleString()}W from grid`;
		if (solar.netWatts < -50) return `Exporting ${Math.abs(solar.netWatts).toLocaleString()}W to grid`;
		return 'Self-sufficient';
	});

	const netColor = $derived.by(() => {
		if (!solar) return 'text-slate-400';
		if (solar.gridExportW > 50) return 'text-green-300';
		if (solar.gridImportW > 50) return 'text-amber-300';
		if (solar.netWatts > 50) return 'text-amber-300';
		if (solar.netWatts < -50) return 'text-green-300';
		return 'text-emerald-300';
	});

	const netIcon = $derived.by(() => {
		if (!solar) return 'mdi:transmission-tower';
		if (solar.gridExportW > 50 || solar.netWatts < -50) return 'mdi:transmission-tower-export';
		if (solar.gridImportW > 50 || solar.netWatts > 50) return 'mdi:transmission-tower-import';
		return 'mdi:home-lightning-bolt';
	});

	// Sparkline SVG path from history
	const sparklinePath = $derived.by(() => {
		if (history.length < 3) return '';
		const watts = history.map(p => p.watts);
		const max = Math.max(...watts, 1);
		const width = 200;
		const height = 40;
		const step = width / (watts.length - 1);

		const points = watts.map((w, i) => {
			const x = i * step;
			const y = height - (w / max) * (height - 4);
			return `${x},${y}`;
		});

		return `M${points.join(' L')}`;
	});

	// Fill area under sparkline
	const sparklineFill = $derived.by(() => {
		if (history.length < 3) return '';
		const watts = history.map(p => p.watts);
		const max = Math.max(...watts, 1);
		const width = 200;
		const height = 40;
		const step = width / (watts.length - 1);

		const points = watts.map((w, i) => {
			const x = i * step;
			const y = height - (w / max) * (height - 4);
			return `${x},${y}`;
		});

		return `M0,${height} L${points.join(' L')} L${width},${height} Z`;
	});
</script>

{#if solar}
	<div class="rounded-3xl bg-gradient-to-b from-slate-800/96 to-slate-800/88 p-5 shadow-[0_18px_42px_rgba(2,6,23,0.34),inset_0_1px_0_rgba(255,255,255,0.04)]">
		<div class="mb-3 flex items-center gap-2">
			<Icon icon="mdi:solar-power" width={20} class="text-amber-400" />
			<h2 class="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Solar Production</h2>
		</div>

		<div class="flex items-end justify-between gap-4">
			<div>
				<div class="text-[28px] font-bold leading-none text-white" style="font-variant-numeric: tabular-nums;">
					{solar.production.toLocaleString()} <span class="text-[16px] text-slate-300">W</span>
				</div>
				<div class="mt-2 flex items-center gap-1.5 {netColor}">
					<Icon icon={netIcon} width={14} />
					<p class="text-sm">{netLabel}</p>
				</div>
			</div>
			<div class="text-right space-y-1">
				<div>
					<p class="text-[11px] text-slate-500">Today</p>
					<p class="text-sm font-semibold text-slate-200" style="font-variant-numeric: tabular-nums;">
						{(solar.todayWh / 1000).toFixed(1)} kWh
					</p>
				</div>
				{#if solar.lifetimeKwh > 0}
					<div>
						<p class="text-[11px] text-slate-500">Lifetime</p>
						<p class="text-sm font-semibold text-slate-200" style="font-variant-numeric: tabular-nums;">
							{solar.lifetimeKwh >= 1000
								? `${(solar.lifetimeKwh / 1000).toFixed(1)} MWh`
								: `${solar.lifetimeKwh.toFixed(0)} kWh`}
						</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Sparkline -->
		{#if sparklinePath}
			<div class="mt-4 -mx-1">
				<svg viewBox="0 0 200 40" class="w-full h-10" preserveAspectRatio="none">
					<path d={sparklineFill} fill="url(#solar-gradient)" opacity="0.3" />
					<path d={sparklinePath} fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
					<defs>
						<linearGradient id="solar-gradient" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="#f59e0b" stop-opacity="0.4" />
							<stop offset="100%" stop-color="#f59e0b" stop-opacity="0" />
						</linearGradient>
					</defs>
				</svg>
				<div class="flex justify-between text-[10px] text-slate-500 px-1 mt-0.5">
					<span>24h ago</span>
					<span>Now</span>
				</div>
			</div>
		{/if}
	</div>
{/if}
