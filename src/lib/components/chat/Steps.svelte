<script lang="ts">
	/**
	 * Steps — shows a sequence of AI operations with status indicators.
	 * Each step has a title, optional description, and status (pending/running/done/error).
	 */
	import Icon from '@iconify/svelte';
	import TextShimmer from './TextShimmer.svelte';

	export type StepStatus = 'pending' | 'running' | 'done' | 'error';

	export interface Step {
		id: string;
		title: string;
		description?: string;
		status: StepStatus;
		duration?: string;
	}

	interface Props {
		steps: Step[];
		title?: string;
		collapsible?: boolean;
		defaultOpen?: boolean;
	}

	let { steps, title, collapsible = false, defaultOpen = true }: Props = $props();
	let isOpen = $state(defaultOpen);

	function getStatusIcon(status: StepStatus): string {
		switch (status) {
			case 'done': return 'mdi:check-circle';
			case 'running': return 'mdi:loading';
			case 'error': return 'mdi:alert-circle';
			default: return 'mdi:circle-outline';
		}
	}

	function getStatusColor(status: StepStatus): string {
		switch (status) {
			case 'done': return 'text-green-400';
			case 'running': return 'text-indigo-400';
			case 'error': return 'text-red-400';
			default: return 'text-slate-500';
		}
	}
</script>

<div class="rounded-xl border border-slate-600/30 bg-slate-800/50 overflow-hidden">
	{#if title}
		{#if collapsible}
			<button
				onclick={() => isOpen = !isOpen}
				class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-700/30 transition-colors"
			>
				<Icon
					icon="mdi:chevron-right"
					width={14}
					class="text-slate-400 transition-transform shrink-0 {isOpen ? 'rotate-90' : ''}"
				/>
				<span class="text-xs font-medium text-slate-300">{title}</span>
			</button>
		{:else}
			<div class="px-3 py-2 border-b border-slate-700/30">
				<span class="text-xs font-medium text-slate-300">{title}</span>
			</div>
		{/if}
	{/if}

	{#if isOpen || !collapsible}
		<div class="px-3 py-2 space-y-0.5">
			{#each steps as step, i (step.id)}
				<div class="flex items-start gap-2.5 py-1.5">
					<!-- Status icon + connector line -->
					<div class="flex flex-col items-center shrink-0">
						<div class="{getStatusColor(step.status)} {step.status === 'running' ? 'animate-spin' : ''}">
							<Icon icon={getStatusIcon(step.status)} width={14} />
						</div>
						{#if i < steps.length - 1}
							<div class="w-px h-full min-h-[12px] mt-0.5 bg-slate-600/50"></div>
						{/if}
					</div>

					<!-- Content -->
					<div class="flex-1 min-w-0 -mt-0.5">
						<div class="flex items-center gap-2">
							{#if step.status === 'running'}
								<TextShimmer text={step.title} class="text-xs font-medium" />
							{:else}
								<span class="text-xs font-medium {step.status === 'done' ? 'text-slate-300' : step.status === 'error' ? 'text-red-300' : 'text-slate-500'}">
									{step.title}
								</span>
							{/if}
							{#if step.duration}
								<span class="text-[10px] text-slate-500">{step.duration}</span>
							{/if}
						</div>
						{#if step.description}
							<p class="text-[11px] text-slate-500 mt-0.5">{step.description}</p>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
