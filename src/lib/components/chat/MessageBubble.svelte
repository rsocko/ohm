<script lang="ts">
	import type { ChatMessage } from '$lib/types/chat';
	import DataCard from './DataCard.svelte';
	import ActionConfirmation from './ActionConfirmation.svelte';
	import BatchConfirmation from './BatchConfirmation.svelte';
	import Icon from '@iconify/svelte';
	import { closeChat } from '$lib/stores/chat.svelte';
	import { goto } from '$app/navigation';
	import { marked } from 'marked';

	interface Props {
		message: ChatMessage;
	}

	let { message }: Props = $props();

	const isUser = $derived(message.role === 'user');
	const isError = $derived(message.contentType === 'error');

	function handleDeepLinkClick() {
		closeChat();
	}

	// Configure marked for safe, compact output
	marked.setOptions({
		breaks: true,
		gfm: true,
	});

	// Parse [link:/route]text[/link] markers into navigable anchor tags with a data attribute
	function parseContent(content: string): { html: string; links: Array<{ text: string; route: string }> } {
		const links: Array<{ text: string; route: string }> = [];
		const regex = /\[link:(\/[^\]]*)\]([^[]*)\[\/link\]/g;

		// Replace custom link markers with anchor tags that have a data-deeplink attribute
		const withLinks = content.replace(regex, (_match, route, text) => {
			links.push({ text, route });
			// Escape HTML entities to prevent XSS from AI-generated content
			const safeRoute = route.replace(/[&<>"']/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
			const safeText = text.replace(/[&<>"']/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
			return `<a href="${safeRoute}" data-deeplink class="deep-link">📍 ${safeText}</a>`;
		});

		return { html: marked.parse(withLinks) as string, links };
	}

	const parsed = $derived(parseContent(message.content));

	/** Intercept clicks on internal links and deep links — use SvelteKit navigation */
	function handleContentClick(e: MouseEvent) {
		const anchor = (e.target as HTMLElement).closest('a');
		if (!anchor) return;
		const href = anchor.getAttribute('href');
		if (!href || !href.startsWith('/')) return;

		e.preventDefault();
		closeChat();
		goto(href);
	}
</script>

<div class="flex {isUser ? 'justify-end' : 'justify-start'}">
	<div
		class="max-w-[85%] px-3.5 py-2.5 text-[13px] leading-relaxed
			{isUser ? 'bg-indigo-600 text-white rounded-2xl rounded-br-sm' : ''}
			{!isUser && !isError ? 'bg-slate-700 text-slate-200 rounded-2xl rounded-bl-sm' : ''}
			{isError ? 'bg-red-500/10 border border-red-500/30 text-red-300 rounded-2xl rounded-bl-sm' : ''}"
	>
		<!-- Rendered content -->
		{#if message.content}
			{#if isUser}
				<p class="whitespace-pre-wrap">{message.content}</p>
			{:else}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="chat-markdown prose prose-invert prose-sm max-w-none" onclick={handleContentClick}>
						{@html parsed.html}
					</div>
			{/if}
		{/if}

		<!-- Error icon -->
		{#if isError}
			<div class="flex items-center gap-1.5 mt-1">
				<Icon icon="mdi:alert-circle-outline" width={13} class="text-red-400" />
				<span class="text-[10px] text-red-400">Connection issue</span>
			</div>
		{/if}

		<!-- Data Card -->
		{#if message.dataCard}
			<DataCard data={message.dataCard} />
		{/if}

		<!-- Deep Links -->
		{#if message.deepLinks?.length}
			<div class="flex flex-wrap gap-1.5 mt-2">
				{#each message.deepLinks as link}
					<a
						href={link.route}
						onclick={handleDeepLinkClick}
						class="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-600/50 text-[10px] text-indigo-300 hover:text-indigo-200 transition-colors"
					>
						<Icon icon="mdi:open-in-new" width={10} />
						{link.label}
					</a>
				{/each}
			</div>
		{/if}

		<!-- Action Confirmation -->
		{#if message.actionConfirmation}
			<ActionConfirmation action={message.actionConfirmation} />
		{/if}

		<!-- Batch Confirmation -->
		{#if message.batchConfirmation}
			<BatchConfirmation batch={message.batchConfirmation} />
		{/if}
	</div>
</div>

<style>
	/* Chat markdown styling — compact, no excess spacing */
	.chat-markdown :global(p) {
		margin: 0.35em 0;
	}
	.chat-markdown :global(p:first-child) {
		margin-top: 0;
	}
	.chat-markdown :global(p:last-child) {
		margin-bottom: 0;
	}
	.chat-markdown :global(ul),
	.chat-markdown :global(ol) {
		margin: 0.4em 0;
		padding-left: 1.4em;
	}
	.chat-markdown :global(ol) {
		list-style-type: decimal;
	}
	.chat-markdown :global(ul) {
		list-style-type: disc;
	}
	.chat-markdown :global(li) {
		margin: 0.15em 0;
	}
	.chat-markdown :global(li > p) {
		margin: 0.2em 0;
	}
	.chat-markdown :global(li > ul),
	.chat-markdown :global(li > ol) {
		margin: 0.15em 0;
	}
	.chat-markdown :global(strong) {
		color: #fff;
		font-weight: 600;
	}
	.chat-markdown :global(em) {
		color: #cbd5e1;
	}
	.chat-markdown :global(code) {
		background: rgba(0, 0, 0, 0.3);
		padding: 0.1em 0.35em;
		border-radius: 4px;
		font-size: 0.9em;
	}
	.chat-markdown :global(pre) {
		background: rgba(0, 0, 0, 0.35);
		padding: 0.6em 0.8em;
		border-radius: 8px;
		overflow-x: auto;
		margin: 0.5em 0;
	}
	.chat-markdown :global(pre code) {
		background: none;
		padding: 0;
	}
	.chat-markdown :global(a) {
		color: #93c5fd;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.chat-markdown :global(a:hover) {
		color: #bfdbfe;
	}
	.chat-markdown :global(h1),
	.chat-markdown :global(h2),
	.chat-markdown :global(h3) {
		font-size: 1em;
		font-weight: 700;
		margin: 0.6em 0 0.3em;
		color: #fff;
	}
	.chat-markdown :global(blockquote) {
		border-left: 3px solid rgba(148, 163, 184, 0.3);
		padding-left: 0.8em;
		margin: 0.4em 0;
		color: #94a3b8;
	}
	.chat-markdown :global(hr) {
		border: none;
		border-top: 1px solid rgba(148, 163, 184, 0.2);
		margin: 0.6em 0;
	}
	.chat-markdown :global(table) {
		border-collapse: collapse;
		width: 100%;
		margin: 0.5em 0;
		font-size: 0.9em;
	}
	.chat-markdown :global(th),
	.chat-markdown :global(td) {
		border: 1px solid rgba(148, 163, 184, 0.2);
		padding: 0.3em 0.5em;
	}
	.chat-markdown :global(th) {
		background: rgba(0, 0, 0, 0.2);
		font-weight: 600;
	}
	.chat-markdown :global(a.deep-link) {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
		padding: 0.1em 0.5em;
		border-radius: 6px;
		background: rgba(99, 102, 241, 0.15);
		color: #93c5fd;
		text-decoration: none;
		font-size: 0.9em;
		transition: background 0.15s, color 0.15s;
	}
	.chat-markdown :global(a.deep-link:hover) {
		background: rgba(99, 102, 241, 0.3);
		color: #bfdbfe;
	}
</style>
