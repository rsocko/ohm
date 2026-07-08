import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAiConfig } from '$lib/server/ai-config';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, tool, isStepCount } from 'ai';
import { z } from 'zod';
// AI SDK v7: use provider.chat() for Chat Completions API
import {
	getRecords,
	updateRecord,
	searchAllTables,
	getTableByName
} from '$lib/server/nocodb';

const SYSTEM_PROMPT = `You're Ohm, a friendly and knowledgeable electrical assistant for Ryan's homes. Think of yourself as a helpful housemate who happens to know exactly where every circuit and outlet is — approachable, warm, and quick with a clear answer. You have access to NocoDB tables containing: Areas, Panels, Circuits, Receptacles, and Loads.

Available tables and fields:
- Area: Name, Floor, Description (rooms in the home)
- Panel: Name, Location, Service Size, Phases (electrical panels)
- Circuit: Number, Amps, Description, GFCI Protected, Panel (link), Area (link)
- Receptacle: Name, Receptacle Type, Gang Position, Area (link), Circuit (link)
- Load: Name, Device Type, Wattage, Area (link), Circuit (link)

Relationships:
- Panel → Circuits (one panel has many circuits)
- Circuit → Loads, Receptacles (one circuit serves many devices)
- Area → Loads, Receptacles, Circuits (one room has many devices)

When answering questions:
- Be warm and conversational, but stay specific with circuit numbers and panel locations — friendliness never means vagueness
- If a query is ambiguous, list all matches and ask a quick clarifying question
- For update requests, ALWAYS propose changes and wait for confirmation — never modify data directly
- Reference data by room/area name for readability
- Keep responses concise and easy to skim on a mobile screen — a little personality is welcome, but don't ramble
- When referencing navigable entities, include link markers: [link:/panels?panel=ID]Panel Name[/link] or [link:/rooms?area=ID]Room Name[/link]`;

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const config = await getAiConfig();

	// Handle action confirmation execution (legacy path, keep for now)
	if (body.message === '__CONFIRM_ACTION__' && body.action) {
		const { table: tableName, changes } = body.action;
		const table = await getTableByName(tableName);
		if (!table) {
			return json({ message: `Error: Table "${tableName}" not found` });
		}

		let success = 0;
		let failed = 0;
		const errors: string[] = [];

		for (const change of changes) {
			try {
				await updateRecord(table.id, Number(change.recordId), {
					[change.field]: change.newValue
				});
				success++;
			} catch (err) {
				failed++;
				errors.push(`${change.label}: ${err instanceof Error ? err.message : 'Failed'}`);
			}
		}

		const message =
			failed === 0
				? `✓ Successfully updated ${success} record(s).`
				: `Updated ${success}, failed ${failed}: ${errors.join('; ')}`;

		return json({ message });
	}

	// Build context string
	const ctx = body.context || {};
	const contextInfo = [
		ctx.currentRoute && `Viewing: ${ctx.currentRoute}`,
		ctx.selectedRoom && `Room: ${ctx.selectedRoom}`,
		ctx.selectedCircuit && `Circuit: ${ctx.selectedCircuit}`,
		ctx.selectedPanel && `Panel: ${ctx.selectedPanel}`
	]
		.filter(Boolean)
		.join(', ');

	const systemMessage = contextInfo
		? `${SYSTEM_PROMPT}\n\nCurrent user context: ${contextInfo}`
		: SYSTEM_PROMPT;

	// Build message history for AI SDK v7 format (no system messages in messages array)
	const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
		...(body.history || [])
			.filter((m: { role: string }) => m.role !== 'system')
			.slice(-10)
			.map((m: { role: string; content: string }) => ({
				role: m.role as 'user' | 'assistant',
				content: m.content
			})),
		{ role: 'user', content: body.message }
	];

	// Create OpenAI-compatible provider pointed at Open WebUI (Chat Completions API)
	const provider = createOpenAI({
		baseURL: `${config.openWebUiUrl}/api`,
		apiKey: config.openWebUiApiKey,
	});

	try {
		const result = streamText({
			model: provider.chat(config.openWebUiModel),
			system: systemMessage,
			messages,
			tools: {
				query_electrical_data: tool({
					description: 'Search and retrieve records from the electrical database. Use this for lookups about circuits, panels, rooms, outlets, or loads.',
					inputSchema: z.object({
						table: z.enum(['Area', 'Panel', 'Circuit', 'Receptacle', 'Load']).describe('Which table to query'),
						search_text: z.string().optional().describe('Text to search for across all fields'),
						limit: z.number().optional().describe('Maximum records (default 25)')
					}),
					execute: async ({ table: tableName, search_text, limit }) => {
						const tableInfo = await getTableByName(tableName);
						if (!tableInfo) return { error: `Table "${tableName}" not found` };

						if (search_text) {
							const allResults = await searchAllTables(search_text);
							const tableResults = allResults[tableName] || [];
							return { records: tableResults.slice(0, limit || 25), total: tableResults.length };
						}

						const records = await getRecords(tableInfo.id, { pageSize: String(limit || 25) });
						return { records, total: records.length };
					}
				}),
				search_all_tables: tool({
					description: 'Search across ALL tables for a term. Best when you don\'t know which table has the answer.',
					inputSchema: z.object({
						query: z.string().describe('Search term to find across all tables')
					}),
					execute: async ({ query }) => {
						return await searchAllTables(query);
					}
				}),
				propose_update: tool({
					description: 'Propose updating records. This generates a confirmation request for the user — NEVER executes directly.',
					inputSchema: z.object({
						table: z.enum(['Area', 'Panel', 'Circuit', 'Receptacle', 'Load']).describe('Table containing the records'),
						updates: z.array(z.object({
							recordId: z.string().describe('Record ID to update'),
							label: z.string().describe('Human-friendly name for this record'),
							field: z.string().describe('Field name to change'),
							oldValue: z.string().describe('Current value'),
							newValue: z.string().describe('Proposed new value')
						})).describe('Array of proposed changes')
					}),
					execute: async ({ table: tableName, updates }) => {
						// Return structured data — the client will render this as a confirmation card
						return {
							status: 'confirmation_required',
							table: tableName,
							changes: updates
						};
					}
				})
			},
			stopWhen: isStepCount(5),
			onError: ({ error }) => {
				console.error('[AI Chat] Stream error:', error);
			}
		});

		// Build a streaming response that catches errors gracefully
		const textStream = result.textStream;
		const encoder = new TextEncoder();
		const readable = new ReadableStream({
			async start(controller) {
				try {
					for await (const chunk of textStream) {
						controller.enqueue(encoder.encode(chunk));
					}
					controller.close();
				} catch (err) {
					// If the stream errors (e.g., upstream failure), send the error as text
					const errMsg = err instanceof Error ? err.message : 'AI service error';
					console.error('[AI Chat] Stream consumption error:', errMsg);
					controller.enqueue(encoder.encode(`\n\n[Error: ${errMsg}]`));
					controller.close();
				}
			}
		});

		return new Response(readable, {
			headers: { 'Content-Type': 'text/plain; charset=utf-8' }
		});
	} catch (error) {
		console.error('[AI Chat] Error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'AI request failed' },
			{ status: 500 }
		);
	}
};
