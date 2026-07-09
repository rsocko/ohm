<script lang="ts">
	/**
	 * ChatInput — expandable textarea with send, stop, and attachment actions.
	 * Auto-grows with content and handles keyboard shortcuts.
	 */
	import Icon from '@iconify/svelte';

	interface Props {
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		isLoading?: boolean;
		onSend?: (text: string) => void;
		onStop?: () => void;
		showStop?: boolean;
	}

	let {
		value = $bindable(''),
		placeholder = 'Type a message...',
		disabled = false,
		isLoading = false,
		onSend,
		onStop,
		showStop = false
	}: Props = $props();

	let textarea: HTMLTextAreaElement | undefined = $state(undefined);

	function autoResize() {
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}

	function handleSend() {
		const text = value.trim();
		if (!text || disabled || isLoading) return;
		if (onSend) onSend(text);
		value = '';
		if (textarea) textarea.style.height = 'auto';
	}

	function handleInput() {
		autoResize();
	}
</script>

<div class="px-4 pb-4 pt-2 border-t border-slate-700 shrink-0">
	<div class="flex items-end gap-2">
		<div class="flex-1 relative">
			<textarea
				bind:this={textarea}
				bind:value
				oninput={handleInput}
				onkeydown={handleKeydown}
				{placeholder}
				disabled={disabled || isLoading}
				rows={1}
				class="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-60 resize-none overflow-hidden leading-relaxed"
			></textarea>
		</div>

		{#if showStop && isLoading}
			<button
				onclick={onStop}
				class="bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 px-3 py-3 rounded-xl font-medium text-sm active:scale-[0.96] transition-all min-w-[44px] flex items-center justify-center"
				aria-label="Stop generation"
			>
				<Icon icon="mdi:stop" width={18} />
			</button>
		{:else}
			<button
				onclick={handleSend}
				disabled={isLoading || !value.trim()}
				class="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-4 py-3 rounded-xl font-medium text-sm active:scale-[0.96] transition-all min-w-[44px] flex items-center justify-center"
				aria-label="Send message"
			>
				<Icon icon="mdi:send" width={18} />
			</button>
		{/if}
	</div>
</div>
