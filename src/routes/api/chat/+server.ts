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
	getTableByName,
	createRecord,
	getLinkColumns,
	addLinks
} from '$lib/server/nocodb';
import { findBestMatches } from '$lib/server/fuzzy-match';

const SYSTEM_PROMPT = `You're Ohm, a friendly and knowledgeable electrical assistant for Ryan's homes. Think of yourself as a helpful housemate who happens to know exactly where every circuit and outlet is — approachable, warm, and quick with a clear answer. You have access to NocoDB tables containing: Areas, Panels, Circuits, Receptacles, and Loads.

Available tables and fields:
- Area: Name, Floor, Description (rooms in the home)
- Panel: Name, Location, Service Size, Phases (electrical panels)
- Circuit: Number, Amps, Description, GFCI Protected, Panel (link), Area (link)
- Receptacle: Name, Receptacle Type, Gang Position, Loc.Direction, Loc.Placement, Loc.Rec.Index, Load Name(s), Area (link), Circuit (link)
- Load: Name, Device Type, Wattage, Fixture_Count, Area (link), Circuit (link)

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
- When referencing navigable entities, include link markers: [link:/panels?panel=ID]Panel Name[/link] or [link:/rooms?area=ID]Room Name[/link]

Creation capabilities:
- You can CREATE new records (areas, loads, receptacles) — always propose via propose_batch first
- You can ASSIGN circuits in bulk — "circuit 3 controls all lights in kitchen"
- You can handle COMPLEX sentences — parse multiple operations from one utterance
- When creating loads, infer Device Type from context (e.g., "ceiling lights" → type "Light", "ceiling fan" → "Fan", "TV" → "Appliance")
- Default Fixture_Count to 1 unless user specifies (e.g., "4 recessed lights" → Fixture_Count: 4)
- For receptacles, infer type from context (e.g., "dimmer" → "Dimmer Switch", "outlet" → "Outlet", "GFCI" → "GFCI Outlet")
- Auto-generate names following pattern: "{Area Name} {Description}" unless user gives explicit name

Disambiguation rules:
- If user mentions a name that partially matches existing records, list top 3 matches and ask
- If only one close match exists, propose it as best guess with confirmation
- For circuit assignment without explicit circuit number, ASK which circuit
- Loads and receptacles CAN exist without a circuit — don't force assignment

Voice-specific behavior:
- Expect informal/conversational input — "there's 4 recessed cans on circuit 7" is valid
- Parse quantities: "4 recessed lights" → one Load with Fixture_Count=4, not 4 separate loads
- Parse placement: "north wall" → Loc.Direction = "N"
- Parse multi-gang: "3-gang box with a dimmer, switch, and outlet" → 3 receptacles with same Loc.Rec.Index
- If unsure about any detail, propose best guess AND note what you assumed`;

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

	// Handle batch confirmation execution
	if (body.message === '__CONFIRM_BATCH__' && body.batch) {
		const { operations } = body.batch as {
			summary: string;
			operations: Array<{
				action: string;
				table: string;
				label: string;
				fields?: Record<string, unknown>;
				recordId?: string;
				tempId?: string;
				linkField?: string;
				linkTarget?: { table: string; recordId: string };
			}>;
		};

		// Track tempId → real record ID for linking
		const tempIdMap = new Map<string, number>();
		const results: Array<{ label: string; status: string; error?: string }> = [];
		const createdRecords: Array<{ tableId: string; recordId: number }> = [];

		try {
			// Execute creates first, then updates, then links
			const creates = operations.filter((op) => op.action === 'create');
			const updates = operations.filter((op) => op.action === 'update');
			const links = operations.filter((op) => op.action === 'link');
			const unlinks = operations.filter((op) => op.action === 'unlink');

			// Phase 1: Creates
			for (const op of creates) {
				const tableInfo = await getTableByName(op.table);
				if (!tableInfo) {
					results.push({ label: op.label, status: 'failed', error: `Table "${op.table}" not found` });
					continue;
				}
				try {
					const record = await createRecord(tableInfo.id, op.fields || {});
					if (op.tempId) tempIdMap.set(op.tempId, record.id);
					createdRecords.push({ tableId: tableInfo.id, recordId: record.id });
					results.push({ label: op.label, status: 'created' });
				} catch (err) {
					results.push({ label: op.label, status: 'failed', error: err instanceof Error ? err.message : 'Create failed' });
				}
			}

			// Phase 2: Updates
			for (const op of updates) {
				const tableInfo = await getTableByName(op.table);
				if (!tableInfo) {
					results.push({ label: op.label, status: 'failed', error: `Table "${op.table}" not found` });
					continue;
				}
				const recordId = op.tempId ? tempIdMap.get(op.tempId) : Number(op.recordId);
				if (!recordId) {
					results.push({ label: op.label, status: 'failed', error: 'No record ID resolved' });
					continue;
				}
				try {
					await updateRecord(tableInfo.id, recordId, op.fields || {});
					results.push({ label: op.label, status: 'updated' });
				} catch (err) {
					results.push({ label: op.label, status: 'failed', error: err instanceof Error ? err.message : 'Update failed' });
				}
			}

			// Phase 3: Links
			for (const op of [...links, ...unlinks]) {
				if (!op.linkTarget || !op.linkField) {
					results.push({ label: op.label, status: 'failed', error: 'Missing linkTarget or linkField' });
					continue;
				}
				const sourceTable = await getTableByName(op.table);
				if (!sourceTable) {
					results.push({ label: op.label, status: 'failed', error: `Table "${op.table}" not found` });
					continue;
				}
				const sourceRecordId = op.tempId ? tempIdMap.get(op.tempId) : Number(op.recordId);
				if (!sourceRecordId) {
					results.push({ label: op.label, status: 'failed', error: 'No source record ID resolved' });
					continue;
				}
				const targetRecordId = op.linkTarget.recordId.startsWith('temp:')
					? tempIdMap.get(op.linkTarget.recordId.replace('temp:', ''))
					: Number(op.linkTarget.recordId);
				if (!targetRecordId) {
					results.push({ label: op.label, status: 'failed', error: 'No target record ID resolved' });
					continue;
				}

				try {
					const linkCols = await getLinkColumns(sourceTable.id);
					const linkCol = linkCols.find((c) => c.title === op.linkField);
					if (!linkCol) {
						results.push({ label: op.label, status: 'failed', error: `Link column "${op.linkField}" not found` });
						continue;
					}
					if (op.action === 'link') {
						await addLinks(sourceTable.id, linkCol.id, sourceRecordId, [targetRecordId]);
						results.push({ label: op.label, status: 'linked' });
					} else {
						// Unlink: use replaceLinks with empty array for that specific link
						// For simplicity, skip unlink in Phase 1 — noted as future work
						results.push({ label: op.label, status: 'skipped', error: 'Unlink not yet implemented' });
					}
				} catch (err) {
					results.push({ label: op.label, status: 'failed', error: err instanceof Error ? err.message : 'Link failed' });
				}
			}

			const succeeded = results.filter((r) => !['failed', 'skipped'].includes(r.status)).length;
			const failedCount = results.filter((r) => r.status === 'failed').length;

			const message = failedCount === 0
				? `✓ Successfully completed ${succeeded} operation(s).`
				: `Completed ${succeeded}, failed ${failedCount}: ${results.filter((r) => r.status === 'failed').map((r) => `${r.label}: ${r.error}`).join('; ')}`;

			return json({ message, results });
		} catch (err) {
			return json({
				message: `Batch execution error: ${err instanceof Error ? err.message : 'Unknown error'}`,
				results
			});
		}
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
					description: 'Propose updating records. This generates a confirmation request for the user — NEVER executes directly. For multi-step operations (creates + links), use propose_batch instead.',
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
						return {
							status: 'confirmation_required',
							table: tableName,
							changes: updates
						};
					}
				}),
				create_records: tool({
					description: 'Create new records in the electrical database. Use for adding new rooms, loads, receptacles. For multi-step operations, prefer propose_batch to show the user a confirmation first.',
					inputSchema: z.object({
						operations: z.array(z.object({
							table: z.enum(['Area', 'Panel', 'Circuit', 'Receptacle', 'Load']).describe('Which table to create in'),
							fields: z.record(z.string(), z.unknown()).describe('Field values for the new record'),
							tempId: z.string().optional().describe('Temporary ID for referencing in subsequent link operations')
						}))
					}),
					execute: async ({ operations }) => {
						const results = [];
						for (const op of operations) {
							try {
								const tableInfo = await getTableByName(op.table);
								if (!tableInfo) {
									results.push({ tempId: op.tempId, error: `Table "${op.table}" not found` });
									continue;
								}
								const record = await createRecord(tableInfo.id, op.fields);
								results.push({ tempId: op.tempId, table: op.table, recordId: record.id, fields: record.fields });
							} catch (err) {
								results.push({
									tempId: op.tempId,
									table: op.table,
									error: err instanceof Error ? err.message : 'Create failed'
								});
							}
						}
						return { created: results };
					}
				}),
				assign_circuit: tool({
					description: 'Find loads and/or receptacles to assign to a circuit. Returns matches for confirmation — does not execute directly. Use when user says things like "circuit 3 controls all lights in the kitchen".',
					inputSchema: z.object({
						circuit_search: z.string().describe('Circuit identifier (number or description)'),
						area_search: z.string().optional().describe('Area/room to filter by'),
						load_names: z.array(z.string()).optional().describe('Specific load names to assign'),
						receptacle_names: z.array(z.string()).optional().describe('Specific receptacle names to assign'),
						assign_all_in_area: z.boolean().optional().describe('If true, assign ALL loads+receptacles in the specified area')
					}),
					execute: async ({ circuit_search, area_search, load_names, receptacle_names, assign_all_in_area }) => {
						// Find the circuit
						const circuitResults = await searchAllTables(circuit_search);
						const circuits = circuitResults['Circuit'] || [];
						if (circuits.length === 0) {
							return { error: `No circuit found matching "${circuit_search}"` };
						}
						if (circuits.length > 1) {
							return {
								status: 'disambiguation_required',
								message: `Multiple circuits match "${circuit_search}"`,
								matches: circuits.map((c) => ({ id: c.id, fields: c.fields }))
							};
						}
						const circuit = circuits[0];

						// Find loads/receptacles to assign
						const toAssign: Array<{ table: string; id: number; name: string }> = [];

						if (assign_all_in_area && area_search) {
							const areaResults = await searchAllTables(area_search);
							const areas = areaResults['Area'] || [];
							if (areas.length === 0) return { error: `No area found matching "${area_search}"` };
							const area = areas[0];

							// Get all loads and receptacles, filter by area
							const loadTable = await getTableByName('Load');
							const recTable = await getTableByName('Receptacle');
							if (loadTable) {
								const loads = await getRecords(loadTable.id, { pageSize: '200' });
								for (const l of loads) {
									const areaField = l.fields['Area'] as { id?: number } | undefined;
									if (areaField?.id === area.id) {
										toAssign.push({ table: 'Load', id: l.id, name: String(l.fields['Name'] || l.id) });
									}
								}
							}
							if (recTable) {
								const recs = await getRecords(recTable.id, { pageSize: '200' });
								for (const r of recs) {
									const areaField = r.fields['Area'] as { id?: number } | undefined;
									if (areaField?.id === area.id) {
										toAssign.push({ table: 'Receptacle', id: r.id, name: String(r.fields['Name'] || r.id) });
									}
								}
							}
						} else {
							// Search for specific load/receptacle names
							for (const name of (load_names || [])) {
								const results = await searchAllTables(name);
								for (const l of (results['Load'] || [])) {
									toAssign.push({ table: 'Load', id: l.id, name: String(l.fields['Name'] || l.id) });
								}
							}
							for (const name of (receptacle_names || [])) {
								const results = await searchAllTables(name);
								for (const r of (results['Receptacle'] || [])) {
									toAssign.push({ table: 'Receptacle', id: r.id, name: String(r.fields['Name'] || r.id) });
								}
							}
						}

						if (toAssign.length === 0) {
							return { error: 'No loads or receptacles found matching the criteria' };
						}

						return {
							status: 'confirmation_required',
							circuit: { id: circuit.id, fields: circuit.fields },
							assignments: toAssign,
							summary: `Assign ${toAssign.length} item(s) to Circuit ${circuit.fields['Number'] || circuit.id}`
						};
					}
				}),
				propose_batch: tool({
					description: 'Propose a batch of changes (creates, updates, link assignments) for user confirmation. ALWAYS use this for multi-step operations like creating a load + receptacle + linking to circuit. The UI will show a table of all proposed changes.',
					inputSchema: z.object({
						summary: z.string().describe('One-line description of what this batch does'),
						operations: z.array(z.object({
							action: z.enum(['create', 'update', 'link', 'unlink']).describe('Operation type'),
							table: z.enum(['Area', 'Panel', 'Circuit', 'Receptacle', 'Load']).describe('Target table'),
							label: z.string().describe('Human-readable description of this operation'),
							fields: z.record(z.string(), z.unknown()).optional().describe('Fields for create/update'),
							recordId: z.string().optional().describe('Record ID for update/link operations'),
							tempId: z.string().optional().describe('Temporary ID for referencing new records in subsequent operations'),
							linkField: z.string().optional().describe('Link column title for link/unlink operations (e.g., "Circuit", "Area")'),
							linkTarget: z.object({
								table: z.string().describe('Target table name'),
								recordId: z.string().describe('Target record ID')
							}).optional().describe('Target for link operations')
						}))
					}),
					execute: async ({ summary, operations }) => {
						return {
							status: 'batch_confirmation_required',
							summary,
							operations
						};
					}
				}),
				fuzzy_search: tool({
					description: 'Fuzzy search for records when exact text matching fails. Use when looking for records by name and the user may have used different words (e.g., "master bedroom" vs "Primary Bedroom", "ceiling lights" vs "Recessed Cans"). Returns scored matches.',
					inputSchema: z.object({
						table: z.enum(['Area', 'Panel', 'Circuit', 'Receptacle', 'Load']).describe('Which table to search'),
						query: z.string().describe('Search query (name, description, or partial match)'),
						field: z.string().optional().describe('Specific field to match against (default: "Name")')
					}),
					execute: async ({ table: tableName, query, field }) => {
						const tableInfo = await getTableByName(tableName);
						if (!tableInfo) return { error: `Table "${tableName}" not found` };

						const records = await getRecords(tableInfo.id, { pageSize: '200' });
						const matchField = field || 'Name';

						const matches = findBestMatches(
							query,
							records,
							(r) => String(r.fields[matchField] || ''),
							{ threshold: 0.25, maxResults: 5 }
						);

						return {
							matches: matches.map((m) => ({
								id: m.item.id,
								name: m.label,
								score: Math.round(m.score * 100),
								fields: m.item.fields
							})),
							total: matches.length
						};
					}
				})
			},
			stopWhen: isStepCount(8),
			onError: ({ error }) => {
				console.error('[AI Chat] Stream error:', error);
			}
		});

		// Build a streaming response that includes both text and tool results.
		// Tool results with confirmation status are appended as tagged JSON
		// so the client can render confirmation UI with action buttons.
		const fullStream = result.fullStream;
		const encoder = new TextEncoder();
		const confirmations: Array<{ type: string; data: unknown }> = [];
		const readable = new ReadableStream({
			async start(controller) {
				try {
					for await (const part of fullStream) {
						if (part.type === 'text-delta') {
							controller.enqueue(encoder.encode(part.textDelta));
						} else if (part.type === 'tool-result') {
							const toolResult = part.result as Record<string, unknown>;
							if (toolResult?.status === 'batch_confirmation_required') {
								confirmations.push({
									type: 'batch-confirmation',
									data: { summary: toolResult.summary, operations: toolResult.operations }
								});
							} else if (toolResult?.status === 'confirmation_required' && toolResult?.changes) {
								confirmations.push({
									type: 'action-confirmation',
									data: { table: toolResult.table, changes: toolResult.changes }
								});
							}
						}
					}
					// Append confirmations as tagged JSON after the text stream
					for (const conf of confirmations) {
						const marker = `\n<!--OHM_CONFIRMATION:${JSON.stringify(conf)}-->`;
						controller.enqueue(encoder.encode(marker));
					}
					controller.close();
				} catch (err) {
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
