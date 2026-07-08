<script lang="ts">
	import type { DataCardContent } from '$lib/types/chat';
	import Icon from '@iconify/svelte';

	interface Props {
		data: DataCardContent;
	}

	let { data }: Props = $props();

	function getBadgeClass(type?: string): string {
		switch (type) {
			case 'badge-gfci': return 'text-green-400';
			case 'badge-afci': return 'text-blue-400';
			case 'badge-standard': return 'text-slate-400';
			case 'badge-warning': return 'text-amber-400';
			case 'mono': return 'text-blue-300 font-mono';
			default: return 'text-slate-200';
		}
	}
</script>

<div class="mt-2 p-3 rounded-xl space-y-2 bg-blue-500/[0.08] border border-blue-500/20">
	{#if data.title}
		<div class="flex items-center gap-1.5">
			<Icon icon="mdi:information-outline" width={13} class="text-blue-400" />
			<p class="text-[11px] font-semibold text-blue-300">{data.title}</p>
		</div>
	{/if}

	{#each data.fields as field}
		<div class="flex justify-between items-center">
			<span class="text-[11px] text-slate-400">{field.label}</span>
			<span class="text-[11px] {getBadgeClass(field.type)}">{field.value}</span>
		</div>
	{/each}

	{#if data.footer}
		<p class="text-[11px] text-slate-500 pt-1 border-t border-slate-700/50">{data.footer}</p>
	{/if}
</div>
