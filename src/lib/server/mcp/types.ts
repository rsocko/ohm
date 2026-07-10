/**
 * MCP type definitions — shared across tools, registry, and transport.
 */

/** A single operation within a confirmation payload */
export interface ConfirmationOperation {
	action: 'create' | 'update' | 'link' | 'delete';
	table: string;
	label: string;
	details: Record<string, unknown>;
}

/** Payload returned by write tools — everything needed to render confirmation UI and execute */
export interface ConfirmationPayload {
	id: string;
	tool: string;
	summary: string;
	operations: ConfirmationOperation[];
	execute: ExecuteRequest;
}

/** Request shape sent to /api/mcp/execute after user confirms */
export interface ExecuteRequest {
	tool: string;
	args: Record<string, unknown>;
	confirmed: true;
}

/** Result of a successful tool execution (read or confirmed write) */
export interface ToolResult {
	success: true;
	data: unknown;
}

/** Result when a write tool needs confirmation */
export interface ToolConfirmation {
	success: true;
	confirmation: ConfirmationPayload;
}

/** Result when a tool fails */
export interface ToolError {
	success: false;
	error: string;
}

export type ToolResponse = ToolResult | ToolConfirmation | ToolError;

/** Tool parameter definition */
export interface ToolParam {
	type: 'string' | 'number' | 'boolean';
	description: string;
	required?: boolean;
	enum?: string[];
}

/** Tool definition for the registry */
export interface ToolDefinition {
	name: string;
	description: string;
	category: 'read' | 'write' | 'smart';
	parameters: Record<string, ToolParam>;
	/** Execute the tool. Write tools return ToolConfirmation; reads return ToolResult. */
	execute(args: Record<string, unknown>): Promise<ToolResponse>;
	/** Execute a confirmed write operation (only for write/smart tools). */
	executeConfirmed?(args: Record<string, unknown>): Promise<ToolResult | ToolError>;
}

/** SSE event types for the chat stream */
export type SSEEventType = 'text' | 'confirmation' | 'data' | 'error' | 'done';

export interface SSEEvent {
	event: SSEEventType;
	data: unknown;
}

/** Helper to generate unique confirmation IDs */
export function generateConfirmationId(): string {
	return `conf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Home context injected into every tool call.
 * Provides automatic scoping — tools query only within the active home.
 */
export interface HomeContext {
	homeId: number;
	homeName: string;
}

/**
 * Extract home context from tool args (injected by the chat endpoint).
 * Returns undefined if no home context was provided (tools should handle gracefully).
 */
export function getHomeContext(args: Record<string, unknown>): HomeContext | undefined {
	return args._homeContext as HomeContext | undefined;
}
