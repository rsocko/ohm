<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { chatState, initChat, sendMessage, clearMessages } from '$lib/stores/chat.svelte';
	import MessageBubble from '$lib/components/chat/MessageBubble.svelte';
	import SuggestionChips from '$lib/components/chat/SuggestionChips.svelte';
	import TypingIndicator from '$lib/components/chat/TypingIndicator.svelte';

	let { data } = $props<{ data: { aiEnabled: boolean } }>();
	let input = $state('');
	let chatContainer: HTMLElement | undefined = $state(undefined);

	onMount(() => {
		initChat();
		if (!data.aiEnabled) return;
		const q = new URL(window.location.href).searchParams.get('q');
		if (q) {
			input = q;
			void handleSend();
		}
	});

	function scrollToBottom() {
		setTimeout(() => {
			if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
		}, 50);
	}

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

<svelte:head>
	<title>AI Assistant — Electrical Config</title>
</svelte:head>

{#if data.aiEnabled}
	<div class="flex flex-col h-[calc(100dvh-4rem)] max-w-3xl mx-auto px-4">
		<!-- Header -->
		<div class="flex items-center justify-between py-4 shrink-0">
			<div class="flex items-center gap-3">
				<div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-800 flex items-center justify-center shadow-lg shadow-indigo-900/30">
					<Icon icon="mdi:flash" width={22} class="text-white" />
				</div>
				<div>
					<h1 class="text-lg font-semibold text-white">AI Assistant</h1>
					<p class="text-xs text-slate-400">Ask about circuits, panels, rooms, or request changes</p>
				</div>
			</div>
			{#if chatState.messages.length > 0}
				<button
					onclick={clearMessages}
					class="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
					title="New conversation"
				>
					<Icon icon="mdi:pencil-plus-outline" width={18} />
				</button>
			{/if}
		</div>

		<!-- Messages -->
		<div class="relative flex-1 min-h-0">
			<div class="absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-slate-900 to-transparent z-10 pointer-events-none"></div>
			<div class="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-slate-900 to-transparent z-10 pointer-events-none"></div>
			<div bind:this={chatContainer} class="h-full overflow-y-auto py-4 space-y-4 -mx-2 px-2">
			{#if chatState.messages.length === 0}
				<div class="flex flex-col items-center justify-center h-full text-center space-y-6 py-12">
					<div class="w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-700/50 flex items-center justify-center">
						<Icon icon="mdi:chat-processing-outline" width={32} class="text-indigo-400" />
					</div>
					<div class="space-y-2">
						<p class="text-base font-medium text-slate-200">What would you like to know?</p>
						<p class="text-sm text-slate-500 max-w-sm" style="text-wrap: pretty">
							Ask about your electrical system — circuits, panels, rooms, outlets, loads, or request data changes.
						</p>
					</div>
					<div class="pt-2">
						<SuggestionChips onselect={handleSuggestion} />
					</div>
				</div>
			{:else}
				{#each chatState.messages as msg (msg.id)}
					<MessageBubble message={msg} />
				{/each}

				{#if chatState.isLoading}
					<TypingIndicator />
				{/if}
			{/if}
			</div>
		</div>

		<!-- Suggestion chips when conversation is short -->
		{#if chatState.messages.length > 0 && chatState.messages.length < 4 && !chatState.isLoading}
			<div class="pb-2 shrink-0">
				<SuggestionChips onselect={handleSuggestion} />
			</div>
		{/if}

		<!-- Input -->
		<div class="pb-4 pt-3 border-t border-slate-700/50 shrink-0">
			{#if chatState.messages.length === 0}
				<div class="mb-3">
					<SuggestionChips onselect={handleSuggestion} count={5} />
				</div>
			{/if}

			<div class="flex gap-2">
				<input
					type="text"
					bind:value={input}
					onkeydown={handleKeydown}
					placeholder="Ask about your electrical setup..."
					disabled={chatState.isLoading}
					class="flex-1 bg-slate-900/80 border border-slate-600/50 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors disabled:opacity-60"
				/>
				<button
					onclick={handleSend}
					disabled={chatState.isLoading || !input.trim()}
					class="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-4 py-3 rounded-xl font-medium text-sm active:scale-[0.96] transition-transform,background-color min-w-[44px] min-h-[44px] flex items-center justify-center"
					aria-label="Send message"
				>
					{#if chatState.isLoading}
						<Icon icon="mdi:loading" width={18} class="animate-spin" />
					{:else}
						<Icon icon="mdi:send" width={18} />
					{/if}
				</button>
			</div>
		</div>
	</div>
{:else}
	<div class="max-w-xl mx-auto px-4 py-10">
		<div class="rounded-2xl border border-slate-700/60 bg-slate-800/50 p-6 text-center shadow-[0_16px_48px_rgba(15,23,42,0.28)]">
			<div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700/50 bg-slate-900/70">
				<Icon icon="mdi:chat-off-outline" width={28} class="text-slate-300" />
			</div>
			<h1 class="mt-4 text-lg font-semibold text-white">AI Assistant is disabled</h1>
			<p class="mt-2 text-sm text-slate-400" style="text-wrap: pretty">
				Enable it in Settings → AI Assistant.
			</p>
			<a
				href="/settings"
				class="mt-5 inline-flex min-h-[40px] items-center justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 active:scale-[0.96]"
			>
				Open Settings
			</a>
		</div>
	</div>
{/if}
