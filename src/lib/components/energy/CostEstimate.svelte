<script lang="ts">
	import type { CostEstimate as CostEstimateType } from '$lib/types/energy';

	let { cost, totalWatts }: { cost: CostEstimateType | null; totalWatts: number } = $props();
</script>

{#if cost}
	<div class="flex items-center justify-between rounded-2xl bg-slate-950/25 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.06)]">
		<span class="text-sm text-slate-400">Daily cost estimate</span>
		<span class="text-sm font-semibold text-slate-100">~${cost.dailyCost.toFixed(2)}/day</span>
	</div>
{/if}
