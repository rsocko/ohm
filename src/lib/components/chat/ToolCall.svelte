<script lang="ts">
	/**
	 * ToolCall — displays a tool invocation with name, arguments, and result.
	 * Shows the AI's tool usage transparently to the user.
	 */
	import Icon from '@iconify/svelte';

	export type ToolCallStatus = 'running' | 'done' | 'error';

	interface Props {
		name: string;
		status?: ToolCallStatus;
		args?: Record<string, unknown>;
		result?: string;
		duration?: string;
		collapsible?: boolean;
		defaultOpen?: boolean;
	}

	let { name, status = 'done', args, result, duration, collapsible = true, defaultOpen = false }: Props = $props();
	let isOpen = $state(defaultOpen);

	function getStatusIcon(s: ToolCallStatus): string {
		switch (s) {
			case 'done': return 'mdi:check-circle';
			case 'running': return 'mdi:loading';
			case 'error': return 'mdi:alert-circle';
		}
	}

	function getStatusColor(s: ToolCallStatus): string {
		switch (s) {
			case 'done': return 'text-green-400';
			case 'running': return 'text-indigo-400 animate-spin';
			case 'error': return 'text-red-400';
		}
	}

	function formatArgs(obj: Record<string, unknown>): string {
		return JSON.stringify(obj, null, 2);
	}
</script>

<div class="rounded-xl border border-slate-600/30 bg-slate-800/50 overflow-hidden">
	<button
		onclick={() => { if (collapsible) isOpen = !isOpen; }}
		class="w-full flex items-center gap-2 px-3 py-2 text-left {collapsible ? 'hover:bg-slate-700/30 cursor-pointer' : 'cursor-default'} transition-colors"
	>
		<div class="{getStatusColor(status)} shrink-0">
			<Icon icon={getStatusIcon(status)} width={14} />
		</div>
		<Icon icon="mdi:wrench" width={12} class="text-amber-400 shrink-0" />
		<span class="text-xs font-medium text-slate-300 flex-1 truncate">
			{name}
		</span>
		{#if duration}
			<span class="text-[10px] text-slate-500">{duration}</span>
		{/if}
		{#if collapsible}
			<Icon
				icon="mdi:chevron-right"
				width={14}
				class="text-slate-500 transition-transform shrink-0 {isOpen ? 'rotate-90' : ''}"
			/>
		{/if}
	</button>

	{#if isOpen}
		<div class="px-3 pb-3 border-t border-slate-700/30 space-y-2">
			{#if args && Object.keys(args).length > 0}
				<div class="mt-2">
					<span class="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Arguments</span>
					<pre class="mt-1 p-2 rounded-lg bg-slate-900/60 text-[11px] text-slate-400 font-mono overflow-x-auto">{formatArgs(args)}</pre>
				</div>
			{/if}
			{#if result}
				<div>
					<span class="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Result</span>
					<pre class="mt-1 p-2 rounded-lg bg-slate-900/60 text-[11px] text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap">{result}</pre>
				</div>
			{/if}
		</div>
	{/if}
</div>
