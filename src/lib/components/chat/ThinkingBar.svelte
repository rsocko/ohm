<script lang="ts">
	/**
	 * ThinkingBar — displays AI "thinking" state with shimmer and optional stop action.
	 * Shows an animated bar indicating the model is processing.
	 */
	import Icon from '@iconify/svelte';
	import TextShimmer from './TextShimmer.svelte';

	interface Props {
		text?: string;
		showStop?: boolean;
		onstop?: () => void;
		duration?: string;
	}

	let { text = 'Thinking...', showStop = false, onstop, duration }: Props = $props();
</script>

<div class="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-700/40 border border-slate-600/30">
	<!-- Animated bar -->
	<div class="thinking-bar-track relative w-5 h-5 flex items-center justify-center shrink-0">
		<div class="thinking-bar-dot"></div>
	</div>

	<div class="flex-1 min-w-0">
		<TextShimmer {text} class="text-xs font-medium" />
		{#if duration}
			<span class="text-[10px] text-slate-500 ml-2">{duration}</span>
		{/if}
	</div>

	{#if showStop && onstop}
		<button
			onclick={onstop}
			class="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-600/50 transition-colors"
			title="Stop generation"
		>
			<Icon icon="mdi:stop-circle-outline" width={16} />
		</button>
	{/if}
</div>

<style>
	.thinking-bar-track {
		position: relative;
	}

	.thinking-bar-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #818cf8;
		animation: pulse-dot 1.5s ease-in-out infinite;
	}

	.thinking-bar-dot::before,
	.thinking-bar-dot::after {
		content: '';
		position: absolute;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #818cf8;
		opacity: 0;
		animation: ripple 1.5s ease-out infinite;
	}

	.thinking-bar-dot::after {
		animation-delay: 0.5s;
	}

	@keyframes pulse-dot {
		0%, 100% { opacity: 0.5; transform: scale(0.8); }
		50% { opacity: 1; transform: scale(1); }
	}

	@keyframes ripple {
		0% { opacity: 0.6; transform: scale(1); }
		100% { opacity: 0; transform: scale(2.5); }
	}
</style>
