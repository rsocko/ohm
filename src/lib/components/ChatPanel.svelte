<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { chatState, initChat, sendMessage, clearMessages, toggleChat, closeChat } from '$lib/stores/chat.svelte';
	import {
		ChatBubble,
		ChatMessageList,
		ChatInput,
		ThinkingBar,
		FeedbackBar,
		SuggestionChips
	} from './chat/index';

	let input = $state('');

	onMount(() => {
		initChat();
	});

	const scrollTrigger = $derived(chatState.messages.length + (chatState.isLoading ? 1 : 0));

	async function handleSend(text: string) {
		if (!text || chatState.isLoading) return;
		await sendMessage(text);
	}

	function handleSuggestion(text: string) {
		handleSend(text);
	}

	function handleCopyMessage(content: string) {
		navigator.clipboard.writeText(content);
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
		<ChatMessageList {scrollTrigger}>
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

			{#each chatState.messages as msg, i (msg.id)}
				<ChatBubble message={msg}>
					{#snippet actions()}
						{#if msg.role === 'assistant' && msg.contentType !== 'error'}
							<FeedbackBar
								onCopy={() => handleCopyMessage(msg.content)}
								showRegenerate={i === chatState.messages.length - 1}
								onRegenerate={() => {
									const lastUser = chatState.messages.filter(m => m.role === 'user').pop();
									if (lastUser) handleSend(lastUser.content);
								}}
							/>
						{/if}
					{/snippet}
				</ChatBubble>
			{/each}

			{#if chatState.isLoading}
				<ThinkingBar text="Thinking..." showStop={true} onstop={() => {}} />
			{/if}
		</ChatMessageList>

		<!-- Suggestion chips (show when empty or few messages) -->
		{#if chatState.messages.length < 3 && !chatState.isLoading}
			<div class="px-4 pb-2 shrink-0">
				<SuggestionChips onselect={handleSuggestion} />
			</div>
		{/if}

		<!-- Input -->
		<ChatInput
			bind:value={input}
			placeholder="Ask about your electrical setup..."
			disabled={false}
			isLoading={chatState.isLoading}
			onSend={handleSend}
			showStop={true}
		/>
	</div>
{/if}
