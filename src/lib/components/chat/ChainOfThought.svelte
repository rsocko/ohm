<script lang="ts">
	/**
	 * ChainOfThought — multi-step collapsible reasoning trace.
	 * Each step can have its own status (thinking, done) and nested content.
	 */
	import Icon from '@iconify/svelte';
	import TextShimmer from './TextShimmer.svelte';

	export interface ThoughtStep {
		id: string;
		title: string;
		content?: string;
		status: 'thinking' | 'done';
		duration?: string;
	}

	interface Props {
		steps: ThoughtStep[];
		title?: string;
		defaultOpen?: boolean;
	}

	let { steps, title = 'Chain of Thought', defaultOpen = false }: Props = $props();
	let isOpen = $state(defaultOpen);

	const completedCount = $derived(steps.filter(s => s.status === 'done').length);
	const isThinking = $derived(steps.some(s => s.status === 'thinking'));
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
		{#if isThinking}
			<div class="w-3.5 h-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0"></div>
		{:else}
			<Icon icon="mdi:thought-bubble-outline" width={14} class="text-purple-400 shrink-0" />
		{/if}
		<span class="text-xs font-medium text-slate-300 flex-1">
			{#if isThinking}
				<TextShimmer text={title} />
			{:else}
				{title}
			{/if}
		</span>
		<span class="text-[10px] text-slate-500">{completedCount}/{steps.length}</span>
	</button>

	{#if isOpen}
		<div class="px-3 pb-3 border-t border-slate-700/30">
			<div class="mt-2 space-y-2 pl-2">
				{#each steps as step (step.id)}
					<div class="flex items-start gap-2">
						<!-- Status indicator -->
						{#if step.status === 'thinking'}
							<div class="w-3.5 h-3.5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin shrink-0 mt-0.5"></div>
						{:else}
							<Icon icon="mdi:check-circle" width={14} class="text-green-400 shrink-0 mt-0.5" />
						{/if}

						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								{#if step.status === 'thinking'}
									<TextShimmer text={step.title} class="text-[11px] font-medium" />
								{:else}
									<span class="text-[11px] font-medium text-slate-300">{step.title}</span>
								{/if}
								{#if step.duration}
									<span class="text-[10px] text-slate-500">{step.duration}</span>
								{/if}
							</div>
							{#if step.content}
								<p class="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{step.content}</p>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
