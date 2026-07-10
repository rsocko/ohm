<script lang="ts">
	/**
	 * BatchConfirmation — table (tablet+) or stacked cards (mobile) showing
	 * grouped proposed changes before commit. Follows the design mockup in
	 * docs/mockups/voice-config-batch-confirmation.html.
	 */
	import type { BatchConfirmationContent } from '$lib/types/chat';
	import { chatState, confirmBatch, cancelBatch } from '$lib/stores/chat.svelte';
	import Icon from '@iconify/svelte';

	interface Props {
		batch: BatchConfirmationContent;
	}

	let { batch }: Props = $props();

	const isPending = $derived(chatState.pendingConfirmations.length > 0 || chatState.pendingBatch !== null);

	/** Action badge config: icon, label, and color class per action type. */
	const actionConfig: Record<string, { icon: string; label: string; bg: string; text: string; border: string }> = {
		create: { icon: 'mdi:plus', label: 'Create', bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
		update: { icon: 'mdi:pencil', label: 'Update', bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30' },
		link:   { icon: 'mdi:link-variant', label: 'Link', bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
		unlink: { icon: 'mdi:link-variant-off', label: 'Unlink', bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' }
	};

	function getActionStyle(action: string) {
		return actionConfig[action] || actionConfig.update;
	}

	function formatDetails(op: typeof batch.operations[0]): string {
		if (!op.fields) return '';
		const parts: string[] = [];
		for (const [key, value] of Object.entries(op.fields)) {
			if (value !== undefined && value !== null && value !== '') {
				parts.push(`${key}: ${value}`);
			}
		}
		return parts.join(' · ');
	}
</script>

<div class="mt-2 rounded-xl overflow-hidden bg-slate-800/60 border border-slate-600/30">
	<!-- Header -->
	<div class="px-3 py-2 bg-indigo-500/10 border-b border-slate-600/30 flex items-center gap-2">
		<span class="text-sm">📋</span>
		<span class="text-xs font-semibold text-indigo-300">{batch.summary}</span>
	</div>

	<!-- Table view (≥640px) -->
	<div class="hidden sm:block overflow-x-auto">
		<table class="w-full text-xs">
			<thead>
				<tr class="border-b border-slate-600/30">
					<th class="px-3 py-2 text-left text-slate-400 font-medium">Action</th>
					<th class="px-3 py-2 text-left text-slate-400 font-medium">Table</th>
					<th class="px-3 py-2 text-left text-slate-400 font-medium">Name</th>
					<th class="px-3 py-2 text-left text-slate-400 font-medium">Details</th>
				</tr>
			</thead>
			<tbody>
				{#each batch.operations as op}
					{@const style = getActionStyle(op.action)}
					<tr class="border-b border-slate-600/20 last:border-b-0">
						<td class="px-3 py-2">
							<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase {style.bg} {style.text} border {style.border}">
								<Icon icon={style.icon} width={10} />
								{style.label}
							</span>
						</td>
						<td class="px-3 py-2 text-slate-400">{op.table}</td>
						<td class="px-3 py-2 text-slate-200 font-medium">{op.label}</td>
						<td class="px-3 py-2 text-slate-400">
							{#if op.linkTarget}
								→ {op.linkTarget.table} #{op.linkTarget.recordId}
							{:else}
								{formatDetails(op)}
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- Card view (<640px) -->
	<div class="sm:hidden space-y-1.5 p-2">
		{#each batch.operations as op}
			{@const style = getActionStyle(op.action)}
			<div class="bg-slate-800/80 border border-slate-600/20 rounded-lg p-2.5">
				<div class="flex items-center justify-between mb-1">
					<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase {style.bg} {style.text} border {style.border}">
						<Icon icon={style.icon} width={10} />
						{style.label}
					</span>
					<span class="text-[10px] text-slate-500">{op.table}</span>
				</div>
				<p class="text-xs font-medium text-slate-200 mb-0.5">{op.label}</p>
				{#if op.linkTarget}
					<p class="text-[11px] text-slate-400">→ {op.linkTarget.table} #{op.linkTarget.recordId}</p>
				{:else if formatDetails(op)}
					<p class="text-[11px] text-slate-400 line-clamp-2">{formatDetails(op)}</p>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Confirm / Cancel buttons -->
	{#if isPending}
		<div class="px-3 py-2.5 border-t border-slate-600/30 flex gap-2">
			<button
				class="flex-1 py-2 px-3 rounded-lg text-[11px] font-semibold bg-green-500/20 text-green-400 border border-green-500/30 active:scale-[0.96] transition-transform"
				onclick={confirmBatch}
				disabled={chatState.isLoading}
			>
				{#if chatState.isLoading}
					<Icon icon="mdi:loading" width={12} class="animate-spin inline mr-1" />
					Executing...
				{:else}
					✓ Confirm All
				{/if}
			</button>
			<button
				class="flex-1 py-2 px-3 rounded-lg text-[11px] font-semibold bg-slate-700/50 text-slate-400 border border-slate-600/30 active:scale-[0.96] transition-transform"
				onclick={cancelBatch}
				disabled={chatState.isLoading}
			>
				✕ Cancel
			</button>
		</div>
	{/if}
</div>
