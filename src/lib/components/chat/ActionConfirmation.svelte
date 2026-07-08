<script lang="ts">
	import type { ActionConfirmationContent } from '$lib/types/chat';
	import { chatState, confirmAction, cancelAction } from '$lib/stores/chat.svelte';
	import Icon from '@iconify/svelte';

	interface Props {
		action: ActionConfirmationContent;
	}

	let { action }: Props = $props();

	const isPending = $derived(chatState.pendingAction !== null);
</script>

<div class="mt-2 p-3 rounded-xl space-y-2 bg-blue-500/[0.08] border border-blue-500/20">
	{#each action.changes as change}
		<div class="flex items-center gap-2">
			<div class="w-4 h-4 rounded flex items-center justify-center shrink-0 bg-slate-700/60">
				<Icon icon="mdi:pencil" width={10} class="text-amber-400" />
			</div>
			<span class="text-[11px] text-slate-300">
				{change.label}: <span class="text-slate-500">{change.oldValue}</span> → <span class="text-green-400">{change.newValue}</span>
			</span>
		</div>
	{/each}

	{#if isPending}
		<div class="flex gap-2 mt-3">
			<button
				class="flex-1 py-2 px-3 rounded-lg text-[11px] font-semibold bg-green-500/20 text-green-400 border border-green-500/30 active:scale-[0.96] transition-transform"
				onclick={confirmAction}
			>
				✓ Confirm
			</button>
			<button
				class="flex-1 py-2 px-3 rounded-lg text-[11px] font-semibold bg-slate-700/50 text-slate-400 border border-slate-600/30 active:scale-[0.96] transition-transform"
				onclick={cancelAction}
			>
				✕ Cancel
			</button>
		</div>
	{/if}
</div>
