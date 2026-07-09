<script lang="ts">
	/**
	 * FeedbackBar — thumbs up/down, copy, and regenerate actions for AI messages.
	 * Appears below assistant messages to let users rate and interact.
	 */
	import Icon from '@iconify/svelte';

	type FeedbackValue = 'up' | 'down' | null;

	interface Props {
		onFeedback?: (value: 'up' | 'down') => void;
		onCopy?: () => void;
		onRegenerate?: () => void;
		showCopy?: boolean;
		showRegenerate?: boolean;
		feedback?: FeedbackValue;
	}

	let {
		onFeedback,
		onCopy,
		onRegenerate,
		showCopy = true,
		showRegenerate = true,
		feedback = null
	}: Props = $props();

	let currentFeedback: FeedbackValue = $state(feedback);
	let copied = $state(false);

	function handleFeedback(value: 'up' | 'down') {
		currentFeedback = currentFeedback === value ? null : value;
		if (currentFeedback && onFeedback) onFeedback(currentFeedback);
	}

	function handleCopy() {
		if (onCopy) onCopy();
		copied = true;
		setTimeout(() => { copied = false; }, 2000);
	}
</script>

<div class="flex items-center gap-0.5 mt-1.5">
	<!-- Thumbs up -->
	<button
		onclick={() => handleFeedback('up')}
		class="p-1.5 rounded-lg transition-colors {currentFeedback === 'up' ? 'text-green-400 bg-green-500/10' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/50'}"
		title="Helpful"
	>
		<Icon icon={currentFeedback === 'up' ? 'mdi:thumb-up' : 'mdi:thumb-up-outline'} width={13} />
	</button>

	<!-- Thumbs down -->
	<button
		onclick={() => handleFeedback('down')}
		class="p-1.5 rounded-lg transition-colors {currentFeedback === 'down' ? 'text-red-400 bg-red-500/10' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/50'}"
		title="Not helpful"
	>
		<Icon icon={currentFeedback === 'down' ? 'mdi:thumb-down' : 'mdi:thumb-down-outline'} width={13} />
	</button>

	{#if showCopy}
		<button
			onclick={handleCopy}
			class="p-1.5 rounded-lg transition-colors {copied ? 'text-green-400' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/50'}"
			title={copied ? 'Copied!' : 'Copy response'}
		>
			<Icon icon={copied ? 'mdi:check' : 'mdi:content-copy'} width={13} />
		</button>
	{/if}

	{#if showRegenerate}
		<button
			onclick={onRegenerate}
			class="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors"
			title="Regenerate response"
		>
			<Icon icon="mdi:refresh" width={13} />
		</button>
	{/if}
</div>
