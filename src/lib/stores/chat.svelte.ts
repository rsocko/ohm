/**
 * Chat store — manages conversation state, streaming, and persistence.
 * Uses SSE-based streaming from the MCP chat endpoint.
 */

import type { ChatMessage, ChatContext, BatchConfirmationContent } from '$lib/types/chat';
import type { ConfirmationPayload } from '$lib/server/mcp/types';

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
	pendingConfirmation: null as ConfirmationPayload | null,
	pendingBatch: null as BatchConfirmationContent | null,
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

/** Parse SSE events from a response stream */
async function* parseSSE(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() || ''; // Keep incomplete line in buffer

		let currentEvent = '';
		let currentData = '';

		for (const line of lines) {
			if (line.startsWith('event: ')) {
				currentEvent = line.slice(7);
			} else if (line.startsWith('data: ')) {
				currentData = line.slice(6);
			} else if (line === '' && currentEvent) {
				yield { event: currentEvent, data: currentData };
				currentEvent = '';
				currentData = '';
			}
		}
	}
	// Flush remaining
	if (buffer.startsWith('data: ') && buffer.includes('\n')) {
		// partial flush not needed for well-formed SSE
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

		let accumulated = '';
		let hasAssistantMessage = false;
		let confirmation: ConfirmationPayload | null = null;

		for await (const { event, data } of parseSSE(reader)) {
			if (event === 'text') {
				try {
					const parsed = JSON.parse(data) as { content: string };
					accumulated += parsed.content;
					chatState.streamingContent = accumulated;

					if (!hasAssistantMessage) {
						addMessage({ role: 'assistant', content: accumulated, contentType: 'text' });
						hasAssistantMessage = true;
					} else {
						updateLastAssistantMessage(accumulated);
					}
				} catch { /* skip malformed */ }
			} else if (event === 'confirmation') {
				try {
					confirmation = JSON.parse(data) as ConfirmationPayload;
				} catch { /* skip */ }
			} else if (event === 'error') {
				try {
					const parsed = JSON.parse(data) as { message: string };
					if (!hasAssistantMessage) {
						addMessage({ role: 'assistant', content: parsed.message, contentType: 'error' });
						hasAssistantMessage = true;
					}
				} catch { /* skip */ }
			}
			// 'done' event just ends the loop naturally
		}

		// If we got a confirmation, attach it to the last message
		if (confirmation) {
			chatState.pendingConfirmation = confirmation;
			const msgs = chatState.messages;
			const lastIdx = msgs.length - 1;
			if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
				const batchConfirmation: BatchConfirmationContent = {
					summary: confirmation.summary,
					operations: confirmation.operations.map(op => ({
						action: op.action as BatchConfirmationContent['operations'][number]['action'],
						table: op.table,
						label: op.label,
						fields: op.details
					}))
				};
				chatState.messages = [
					...msgs.slice(0, lastIdx),
					{ ...msgs[lastIdx], contentType: 'batch-confirmation' as const, batchConfirmation }
				];
			}
		}

		// If nothing came back
		if (!hasAssistantMessage && !confirmation) {
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

export async function confirmBatch() {
	const confirmation = chatState.pendingConfirmation;
	if (!confirmation) return;

	chatState.isLoading = true;
	try {
		const response = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				message: '__CONFIRM__',
				confirmation,
				context: chatState.context
			})
		});

		if (!response.ok) throw new Error('Execution failed');
		const result = await response.json();
		addMessage({
			role: 'assistant',
			content: result.message || `✓ Done!`,
			contentType: 'text'
		});
	} catch (error) {
		addMessage({
			role: 'assistant',
			content: error instanceof Error ? error.message : 'Execution failed',
			contentType: 'error'
		});
	} finally {
		chatState.pendingConfirmation = null;
		chatState.isLoading = false;
		saveMessages(chatState.messages);
	}
}

export function cancelBatch() {
	chatState.pendingConfirmation = null;
	addMessage({ role: 'assistant', content: 'Cancelled. What would you like to change?', contentType: 'text' });
	saveMessages(chatState.messages);
}

// Legacy aliases for backward compatibility with existing components
export const confirmAction = confirmBatch;
export const cancelAction = cancelBatch;
