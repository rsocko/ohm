/**
 * Chat store — manages conversation state, streaming, and persistence.
 * Uses @ai-sdk/svelte for streaming and Svelte 5 runes for state.
 */

import type { ChatMessage, ChatContext, ActionConfirmationContent } from '$lib/types/chat';

const STORAGE_KEY = 'electrical-ai-chat-messages';
const MAX_MESSAGES = 200;

function loadMessages(): ChatMessage[] {
	if (typeof window === 'undefined') return [];
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored ? JSON.parse(stored) : [];
	} catch {
		return [];
	}
}

function saveMessages(messages: ChatMessage[]) {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
	} catch {
		localStorage.removeItem(STORAGE_KEY);
	}
}

function generateId(): string {
	return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Reactive state
export const chatState = $state({
	messages: [] as ChatMessage[],
	isLoading: false,
	isOpen: false,
	streamingContent: '',
	pendingAction: null as ActionConfirmationContent | null,
	context: {
		currentRoute: '/',
	} as ChatContext
});

/** Initialize messages from localStorage (call from onMount) */
export function initChat() {
	chatState.messages = loadMessages();
}

export function toggleChat() {
	chatState.isOpen = !chatState.isOpen;
}

export function openChat() {
	chatState.isOpen = true;
}

export function closeChat() {
	chatState.isOpen = false;
}

export function setContext(ctx: Partial<ChatContext>) {
	Object.assign(chatState.context, ctx);
}

export function clearMessages() {
	chatState.messages = [];
	saveMessages([]);
}

function addMessage(msg: Omit<ChatMessage, 'id' | 'timestamp'>): ChatMessage {
	const full: ChatMessage = {
		...msg,
		id: generateId(),
		timestamp: Date.now()
	};
	chatState.messages = [...chatState.messages, full];
	saveMessages(chatState.messages);
	return full;
}

function updateLastAssistantMessage(content: string) {
	const msgs = chatState.messages;
	const lastIdx = msgs.length - 1;
	if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
		chatState.messages = [
			...msgs.slice(0, lastIdx),
			{ ...msgs[lastIdx], content }
		];
	}
}

export async function sendMessage(content: string) {
	if (!content.trim() || chatState.isLoading) return;

	addMessage({ role: 'user', content: content.trim(), contentType: 'text' });
	chatState.isLoading = true;
	chatState.streamingContent = '';

	const history = chatState.messages.slice(-20).map((m) => ({
		role: m.role,
		content: m.content
	}));

	try {
		const response = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				message: content.trim(),
				context: chatState.context,
				history
			})
		});

		if (!response.ok) {
			const errText = await response.text().catch(() => '');
			throw new Error(`AI service error (${response.status}): ${errText.slice(0, 200)}`);
		}

		const reader = response.body?.getReader();
		if (!reader) throw new Error('No response stream');

		const decoder = new TextDecoder();
		let accumulated = '';
		let hasAssistantMessage = false;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			const chunk = decoder.decode(value, { stream: true });
			accumulated += chunk;
			chatState.streamingContent = accumulated;

			if (!hasAssistantMessage) {
				addMessage({ role: 'assistant', content: accumulated, contentType: 'text' });
				hasAssistantMessage = true;
			} else {
				updateLastAssistantMessage(accumulated);
			}
		}

		// If nothing came back, show a generic error
		if (!hasAssistantMessage) {
			addMessage({
				role: 'assistant',
				content: 'No response received. Check AI connection in Settings.',
				contentType: 'error'
			});
		}
	} catch (error) {
		addMessage({
			role: 'assistant',
			content: error instanceof Error ? error.message : 'Failed to connect to AI assistant',
			contentType: 'error'
		});
	} finally {
		chatState.isLoading = false;
		chatState.streamingContent = '';
		saveMessages(chatState.messages);
	}
}

export async function confirmAction() {
	const action = chatState.pendingAction;
	if (!action) return;

	chatState.isLoading = true;
	try {
		const response = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				message: '__CONFIRM_ACTION__',
				action,
				context: chatState.context
			})
		});

		if (!response.ok) throw new Error('Action failed');
		const result = await response.json();
		addMessage({
			role: 'assistant',
			content: result.message || `✓ Updated ${action.changes.length} record(s) successfully.`,
			contentType: 'text'
		});
	} catch (error) {
		addMessage({
			role: 'assistant',
			content: error instanceof Error ? error.message : 'Action failed',
			contentType: 'error'
		});
	} finally {
		chatState.pendingAction = null;
		chatState.isLoading = false;
		saveMessages(chatState.messages);
	}
}

export function cancelAction() {
	chatState.pendingAction = null;
	addMessage({ role: 'assistant', content: 'Action cancelled.', contentType: 'text' });
	saveMessages(chatState.messages);
}
