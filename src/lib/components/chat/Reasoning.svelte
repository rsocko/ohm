<script lang="ts">
	/**
	 * Reasoning — collapsible block showing AI reasoning/thinking process.
	 * Can show markdown content in a muted, indented style.
	 */
	import Icon from '@iconify/svelte';
	import { marked } from 'marked';

	interface Props {
		title?: string;
		content: string;
		defaultOpen?: boolean;
		duration?: string;
	}

	let { title = 'Reasoning', content, defaultOpen = false, duration }: Props = $props();
	let isOpen = $state(defaultOpen);

	const renderedContent = $derived(marked.parse(content) as string);
</script>

<div class="rounded-xl border border-slate-600/30 bg-slate-800/50 overflow-hidden">
	<button
		onclick={() => isOpen = !isOpen}
		class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-700/30 transition-colors"
	>
		<Icon
			icon="mdi:chevron-right"
			width={14}
			class="text-slate-400 transition-transform shrink-0 {isOpen ? 'rotate-90' : ''}"
		/>
		<Icon icon="mdi:brain" width={14} class="text-purple-400 shrink-0" />
		<span class="text-xs font-medium text-slate-300 flex-1">{title}</span>
		{#if duration}
			<span class="text-[10px] text-slate-500">{duration}</span>
		{/if}
	</button>

	{#if isOpen}
		<div class="px-3 pb-3 border-t border-slate-700/30">
			<div class="reasoning-content mt-2 pl-3 border-l-2 border-purple-500/30 text-xs text-slate-400 leading-relaxed">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html renderedContent}
			</div>
		</div>
	{/if}
</div>

<style>
	.reasoning-content :global(p) {
		margin: 0.3em 0;
	}
	.reasoning-content :global(p:first-child) {
		margin-top: 0;
	}
	.reasoning-content :global(strong) {
		color: #cbd5e1;
	}
	.reasoning-content :global(code) {
		background: rgba(0, 0, 0, 0.3);
		padding: 0.1em 0.3em;
		border-radius: 3px;
		font-size: 0.9em;
	}
</style>
