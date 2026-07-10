/**
 * MCP Tool Registry — central dispatcher for all domain tools.
 * 
 * Usage:
 *   import { registry } from '$lib/server/mcp';
 *   const result = await registry.call('get_room_summary', { room_name: 'Kitchen' });
 *   const confirmed = await registry.executeConfirmed('create_room', { ...args });
 */

import type { ToolDefinition, ToolResponse, ToolResult, ToolError, ToolParam, HomeContext } from './types';
import { readTools } from './tools/read';
import { writeTools } from './tools/write';

export type { ToolDefinition, ToolResponse, ToolResult, ToolError, ToolParam, HomeContext };
export type { ConfirmationPayload, ConfirmationOperation, ExecuteRequest, SSEEvent, SSEEventType } from './types';
export { generateConfirmationId, getHomeContext } from './types';

class ToolRegistry {
	private tools = new Map<string, ToolDefinition>();

	register(tool: ToolDefinition): void {
		this.tools.set(tool.name, tool);
	}

	registerAll(tools: ToolDefinition[]): void {
		for (const tool of tools) {
			this.register(tool);
		}
	}

	get(name: string): ToolDefinition | undefined {
		return this.tools.get(name);
	}

	/** List all tools (for MCP tools/list and AI SDK tool generation) */
	list(): ToolDefinition[] {
		return Array.from(this.tools.values());
	}

	/** List tools filtered by category */
	listByCategory(category: 'read' | 'write' | 'smart'): ToolDefinition[] {
		return this.list().filter(t => t.category === category);
	}

	/** Call a tool by name. Injects homeContext into args as _homeContext. */
	async call(name: string, args: Record<string, unknown>, homeContext?: HomeContext): Promise<ToolResponse> {
		const tool = this.tools.get(name);
		if (!tool) {
			return { success: false, error: `Unknown tool: ${name}` };
		}
		try {
			const enrichedArgs = homeContext ? { ...args, _homeContext: homeContext } : args;
			return await tool.execute(enrichedArgs);
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : `Tool "${name}" failed` };
		}
	}

	/** Execute a confirmed write operation. Only works for write/smart tools with executeConfirmed. */
	async executeConfirmed(name: string, args: Record<string, unknown>): Promise<ToolResult | ToolError> {
		const tool = this.tools.get(name);
		if (!tool) {
			return { success: false, error: `Unknown tool: ${name}` };
		}
		if (!tool.executeConfirmed) {
			return { success: false, error: `Tool "${name}" does not support confirmed execution` };
		}
		try {
			return await tool.executeConfirmed(args);
		} catch (err) {
			return { success: false, error: err instanceof Error ? err.message : `Execution of "${name}" failed` };
		}
	}

	/**
	 * Generate AI SDK tool definitions from the registry.
	 * Returns an object suitable for streamText({ tools: ... }).
	 */
	toAISDKTools(): Record<string, { description: string; parameters: Record<string, unknown> }> {
		const tools: Record<string, { description: string; parameters: Record<string, unknown> }> = {};
		for (const tool of this.list()) {
			const properties: Record<string, unknown> = {};
			const required: string[] = [];

			for (const [paramName, param] of Object.entries(tool.parameters)) {
				properties[paramName] = {
					type: param.type,
					description: param.description,
					...(param.enum ? { enum: param.enum } : {})
				};
				if (param.required) required.push(paramName);
			}

			tools[tool.name] = {
				description: tool.description,
				parameters: {
					type: 'object',
					properties,
					required
				}
			};
		}
		return tools;
	}
}

// Singleton registry with all tools registered
export const registry = new ToolRegistry();
registry.registerAll(readTools);
registry.registerAll(writeTools);

/** Check if a ToolResponse contains a confirmation (for type narrowing) */
export function isConfirmation(response: ToolResponse): response is { success: true; confirmation: import('./types').ConfirmationPayload } {
	return response.success === true && 'confirmation' in response;
}

/** Check if a ToolResponse is a successful data result */
export function isDataResult(response: ToolResponse): response is ToolResult {
	return response.success === true && 'data' in response;
}
