<script lang="ts">
	import type { TimeRange } from '$lib/types/energy';

	let { selected = $bindable('live'), onchange }: { selected: TimeRange; onchange?: (range: TimeRange) => void } = $props();

	const ranges: { value: TimeRange; label: string }[] = [
		{ value: 'live', label: 'Live' },
		{ value: '1h', label: '1H' },
		{ value: '24h', label: '24H' },
		{ value: '7d', label: '7D' },
		{ value: '30d', label: '30D' }
	];

	function select(range: TimeRange) {
		selected = range;
		onchange?.(range);
	}
</script>

<div class="flex gap-2 overflow-x-auto pb-1">
	{#each ranges as range}
		<button
			onclick={() => select(range.value)}
			class="shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold transition-transform,background-color,color duration-150 active:scale-96
				{selected === range.value
					? 'bg-indigo-500/18 text-indigo-200 shadow-[inset_0_0_0_1px_rgba(96,165,250,0.28),0_10px_18px_rgba(37,99,235,0.18)]'
					: 'bg-slate-700/78 text-slate-300 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.08)]'}"
		>
			{range.label}
		</button>
	{/each}
</div>
