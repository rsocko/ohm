import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLlmProvider } from '$lib/server/llm-provider';
import { streamText, tool, isStepCount } from 'ai';
import { z } from 'zod';
import { registry, isConfirmation, isDataResult } from '$lib/server/mcp';
import type { ConfirmationPayload, HomeContext } from '$lib/server/mcp';
import { getVocabularySummary } from '$lib/server/db/vocabulary';

const SYSTEM_PROMPT = `You're Ohm, a friendly and knowledgeable electrical assistant for the project owner's homes. Think of yourself as a helpful housemate who happens to know exactly where every circuit and outlet is — approachable, warm, and quick with a clear answer.

You have access to domain-specific tools for querying and modifying the electrical database (homes, rooms, panels, circuits, loads, receptacles), plus cross-feature tools that bridge live data from Home Assistant and UniFi:

Energy & Power:
- Use get_energy_reading to check live power consumption for a circuit, room, or the whole home
- Always include cost estimates when discussing energy usage

Device Status & Control:
- Use get_device_status to check if a device is on/off, current temperature, brightness, etc.
- Use control_device to turn devices on/off or toggle them — the confirmation UI handles approval
- NEVER describe what you'll do — just call the tool

Network:
- Use get_network_device to look up network devices, check if something is online, or find what's on a port

When answering questions:
- Be warm and conversational, but stay specific with circuit numbers and panel locations
- If a query is ambiguous, list all matches and ask a quick clarifying question
- For update/create requests, use write tools — they will show the user a confirmation before executing
- Reference data by room/area name for readability
- Keep responses concise and easy to skim on a mobile screen
- When referencing navigable entities, include link markers: [link:/panels?panel=ID]Panel Name[/link] or [link:/rooms?area=ID]Room Name[/link]

Creation and modification:
- Use create_room, create_device, add_load, add_receptacle for creating new records
- Use update_field for modifying existing records
- Use move_device_to_circuit for reassigning circuits
- NEVER describe what you'll do — just call the tool. The confirmation UI handles user approval.
- When creating loads, infer Device Type from context (e.g., "ceiling lights" → "Light", "ceiling fan" → "Fan")
- Default fixture counts to 1 unless user specifies (e.g., "4 recessed lights" → count 4)
- For receptacles, infer type from context (e.g., "dimmer" → "Dimmer Switch", "outlet" → "Outlet")

Voice-specific behavior:
- Expect informal/conversational input — "there's 4 recessed cans on circuit 7" is valid
- Parse quantities: "4 recessed lights" → one Load with Fixture_Count=4
- Parse placement: "north wall" → direction "N"
- Parse multi-gang: "3-gang box with a dimmer, switch, and outlet" → 3 receptacles
- If unsure about any detail, propose best guess AND note what you assumed

${getVocabularySummary()}`;

/** Format an SSE event line */
function sseEvent(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Build AI SDK tool definitions from the MCP registry */
function buildAITools(confirmations: ConfirmationPayload[], homeContext?: HomeContext) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const aiTools: Record<string, any> = {};

	for (const toolDef of registry.list()) {
		// Build zod schema from tool parameters
		const shape: Record<string, z.ZodTypeAny> = {};
		for (const [paramName, param] of Object.entries(toolDef.parameters)) {
			let zodType: z.ZodTypeAny;
			if (param.type === 'number') {
				zodType = z.number().describe(param.description);
			} else if (param.type === 'boolean') {
				zodType = z.boolean().describe(param.description);
			} else if (param.enum) {
				zodType = z.enum(param.enum as [string, ...string[]]).describe(param.description);
			} else {
				zodType = z.string().describe(param.description);
			}
			shape[paramName] = param.required ? zodType : zodType.optional();
		}

		const inputSchema = z.object(shape);

		aiTools[toolDef.name] = tool({
			description: toolDef.description,
			inputSchema,
			execute: async (args: Record<string, unknown>) => {
				const response = await registry.call(toolDef.name, args, homeContext);
				if (isConfirmation(response)) {
					confirmations.push(response.confirmation);
					return { status: 'confirmation_shown', summary: response.confirmation.summary };
				}
				if (isDataResult(response)) {
					return response.data;
				}
				// Error
				return { error: (response as { error: string }).error };
			}
		});
	}

	return aiTools;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();

	// Handle confirmed execution (user clicked Confirm)
	if (body.message === '__CONFIRM__' && body.confirmation) {
		const conf = body.confirmation as ConfirmationPayload;
		try {
			const result = await registry.executeConfirmed(conf.tool, conf.execute.args);
			if (result.success) {
				return json({ message: `✓ ${conf.summary} — done!`, data: result.data });
			} else {
				return json({ message: `✗ ${(result as { error: string }).error}` });
			}
		} catch (err) {
			return json({ message: `Error: ${err instanceof Error ? err.message : 'Execution failed'}` });
		}
	}

	// Build context string
	const ctx = body.context || {};
	const homeContext: HomeContext | undefined = ctx.selectedHomeId
		? { homeId: Number(ctx.selectedHomeId), homeName: ctx.selectedHomeName || '' }
		: undefined;

	const contextInfo = [
		homeContext && `Active home: ${homeContext.homeName}`,
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

	// Build message history
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

	// Create LLM provider based on configured backend (Ollama, OpenAI, or Open-WebUI)
	const { provider, modelId } = await getLlmProvider();

	// Confirmations collected from tool executions
	const confirmations: ConfirmationPayload[] = [];
	const aiTools = buildAITools(confirmations, homeContext);

	try {
		const result = streamText({
			model: provider.chat(modelId),
			system: systemMessage,
			messages,
			tools: aiTools,
			stopWhen: isStepCount(8),
			onError: ({ error }) => {
				console.error('[AI Chat] Stream error:', error);
			}
		});

		// SSE response: stream text chunks + confirmations at the end
		const textStream = result.textStream;
		const encoder = new TextEncoder();
		const readable = new ReadableStream({
			async start(controller) {
				try {
					for await (const text of textStream) {
						if (text) {
							controller.enqueue(encoder.encode(sseEvent('text', { content: text })));
						}
					}
					// Emit confirmations
					for (const conf of confirmations) {
						controller.enqueue(encoder.encode(sseEvent('confirmation', conf)));
					}
					// Done event
					controller.enqueue(encoder.encode(sseEvent('done', {})));
					controller.close();
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : 'AI service error';
					console.error('[AI Chat] Stream error:', errMsg);
					controller.enqueue(encoder.encode(sseEvent('error', { message: errMsg })));
					controller.close();
				}
			}
		});

		return new Response(readable, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive'
			}
		});
	} catch (error) {
		console.error('[AI Chat] Error:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'AI request failed' },
			{ status: 500 }
		);
	}
};
