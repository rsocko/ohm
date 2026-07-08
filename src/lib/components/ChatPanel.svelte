<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { chatState, initChat, sendMessage, clearMessages, toggleChat, closeChat } from '$lib/stores/chat.svelte';
	import MessageBubble from './chat/MessageBubble.svelte';
	import SuggestionChips from './chat/SuggestionChips.svelte';
	import TypingIndicator from './chat/TypingIndicator.svelte';

	let input = $state('');
	let chatContainer: HTMLElement | undefined = $state(undefined);

	onMount(() => {
		initChat();
	});

	function scrollToBottom() {
		setTimeout(() => {
			if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
		}, 50);
	}

	// Scroll when messages or loading changes
	$effect(() => {
		void chatState.messages.length;
		void chatState.isLoading;
		scrollToBottom();
	});

	async function handleSend() {
		const q = input.trim();
		if (!q || chatState.isLoading) return;
		input = '';
		await sendMessage(q);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}

	function handleSuggestion(text: string) {
		input = text;
		handleSend();
	}
</script>

<!-- Floating Action Button -->
{#if !chatState.isOpen}
	<button
		onclick={toggleChat}
		class="fixed bottom-20 right-4 z-50 w-14 h-14 bg-indigo-600 hover:bg-indigo-500 rounded-full flex items-center justify-center shadow-lg shadow-indigo-900/30 active:scale-[0.96] transition-transform"
		aria-label="Open AI chat"
	>
		<Icon icon="mdi:chat-processing-outline" width={26} class="text-white" />
		{#if chatState.messages.length > 0}
			<div class="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-slate-900"></div>
		{/if}
	</button>
{/if}

<!-- Chat Panel (bottom sheet on mobile, side panel on desktop) -->
{#if chatState.isOpen}
	<!-- Backdrop -->
	<button
		onclick={closeChat}
		class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:bg-black/30"
		aria-label="Close chat"
	></button>

	<!-- Chat Sheet -->
	<div
		class="fixed z-50 flex flex-col bg-slate-800 shadow-2xl
			bottom-0 inset-x-0 rounded-t-2xl border-t border-slate-600
			md:inset-auto md:right-4 md:top-4 md:bottom-4 md:w-[400px] md:rounded-2xl md:border"
		style="height: 70vh; max-height: 650px;"
	>
		<!-- Header -->
		<div class="flex items-center justify-between px-4 pt-3 pb-2 border-b border-slate-700 shrink-0">
			<div class="flex items-center gap-2">
				<Icon icon="mdi:flash" width={18} class="text-indigo-400" />
				<h3 class="text-sm font-semibold text-white">AI Assistant</h3>
				<div class="w-1.5 h-1.5 rounded-full bg-green-400"></div>
			</div>
			<div class="flex items-center gap-1">
				{#if chatState.messages.length > 0}
					<button
						onclick={clearMessages}
						class="p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
						title="Clear chat"
					>
						<Icon icon="mdi:delete-outline" width={16} />
					</button>
				{/if}
				<button
					onclick={closeChat}
					class="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
				>
					<Icon icon="mdi:close" width={18} />
				</button>
			</div>
		</div>

		<!-- Messages -->
		<div class="relative flex-1 min-h-0">
			<!-- Fade overlays -->
			<div class="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-slate-800 to-transparent z-10 pointer-events-none"></div>
			<div class="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-slate-800 to-transparent z-10 pointer-events-none"></div>
			<div
				bind:this={chatContainer}
				class="h-full overflow-y-auto px-4 py-3 space-y-3"
			>
			{#if chatState.messages.length === 0}
				<div class="text-center text-slate-500 text-sm py-6 space-y-3">
					<div class="w-12 h-12 mx-auto rounded-xl bg-slate-700/60 flex items-center justify-center">
						<Icon icon="mdi:flash" width={24} class="text-indigo-400" />
					</div>
					<div>
						<p class="font-medium text-slate-300">Electrical Assistant</p>
						<p class="text-xs mt-1 text-slate-500">Ask about circuits, panels, rooms, or request changes</p>
					</div>
				</div>
			{/if}

			{#each chatState.messages as msg (msg.id)}
				<MessageBubble message={msg} />
			{/each}

			{#if chatState.isLoading}
				<TypingIndicator />
			{/if}
			</div>
		</div>

		<!-- Suggestion chips (show when empty or few messages) -->
		{#if chatState.messages.length < 3 && !chatState.isLoading}
			<div class="px-4 pb-2 shrink-0">
				<SuggestionChips onselect={handleSuggestion} />
			</div>
		{/if}

		<!-- Input -->
		<div class="px-4 pb-4 pt-2 border-t border-slate-700 shrink-0">
			<div class="flex gap-2">
				<input
					type="text"
					bind:value={input}
					onkeydown={handleKeydown}
					placeholder="Ask about your electrical setup..."
					disabled={chatState.isLoading}
					class="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-60"
				/>
				<button
					onclick={handleSend}
					disabled={chatState.isLoading || !input.trim()}
					class="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-4 py-3 rounded-xl font-medium text-sm active:scale-[0.96] transition-transform,background-color min-w-[44px]"
					aria-label="Send message"
				>
					<Icon icon="mdi:send" width={18} />
				</button>
			</div>
		</div>
	</div>
{/if}
