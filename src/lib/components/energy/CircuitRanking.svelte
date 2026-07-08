<script lang="ts">
	import Icon from '@iconify/svelte';
	import type { CircuitReading } from '$lib/types/energy';

	let { circuits, maxDisplay = 6 }: { circuits: CircuitReading[]; maxDisplay?: number } = $props();

	const displayed = $derived(circuits.slice(0, maxDisplay));
	const activeCount = $derived(circuits.filter((c) => c.watts > 5).length);

	function trendIcon(trend: string): string {
		switch (trend) {
			case 'up': return '↑';
			case 'down': return '↓';
			default: return '→';
		}
	}

	function trendColor(trend: string): string {
		switch (trend) {
			case 'up': return 'text-green-300';
			case 'down': return 'text-red-300';
			default: return 'text-slate-300';
		}
	}
</script>

<div class="rounded-3xl bg-gradient-to-b from-slate-800/96 to-slate-800/88 p-5 shadow-[0_18px_42px_rgba(2,6,23,0.34),inset_0_1px_0_rgba(255,255,255,0.04)]">
	<div class="mb-4 flex items-center justify-between">
		<div>
			<h2 class="text-lg font-semibold text-white">Top Consumers</h2>
			<p class="text-sm text-slate-400">Right now</p>
		</div>
		<span class="rounded-full bg-slate-800/90 px-3 py-1 text-[11px] font-semibold text-slate-300 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.08)]">
			{activeCount} active
		</span>
	</div>

	<div class="space-y-1">
		{#each displayed as circuit}
			<div class="border-t border-slate-700/30 py-3 first:border-t-0">
				<div class="mb-2 flex items-center justify-between gap-3">
					<div>
						<p class="text-sm font-semibold text-white">{circuit.circuitName}</p>
						<p class="text-[11px] text-slate-500">{circuit.panelName}</p>
					</div>
					<div class="flex items-center gap-2 text-right">
						<span class="text-base font-semibold text-white" style="font-variant-numeric: tabular-nums;">
							{circuit.watts.toLocaleString()}W
						</span>
						<span class="{trendColor(circuit.trend)} text-sm font-bold">
							{trendIcon(circuit.trend)}
						</span>
					</div>
				</div>
				<div class="flex items-center gap-3">
					<div class="flex-1 h-[7px] overflow-hidden rounded-full bg-slate-950/68 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.06)]">
						<div
							class="h-full rounded-full bg-gradient-to-r from-indigo-400/72 to-cyan-400/88 shadow-[0_0_18px_rgba(34,211,238,0.18)]"
							style="width: {Math.min(circuit.capacityPercent, 100)}%; transition: width 0.3s ease"
						></div>
					</div>
					<span class="text-xs text-slate-400" style="font-variant-numeric: tabular-nums;">
						{circuit.capacityPercent}%
					</span>
				</div>
			</div>
		{/each}

		{#if circuits.length === 0}
			<div class="py-6 text-center text-sm text-slate-500">
					<Icon icon="mdi:loading" width={24} class="mx-auto mb-2 opacity-50 animate-spin" />
					Waiting for live data…
			</div>
		{/if}
	</div>
</div>
