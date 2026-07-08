import { getAiConfig } from '$lib/server/ai-config';

export interface AskElectricalResult {
	answer: string;
	model: string;
	sources: string[];
}

interface OpenWebUiModel {
	id?: string;
	name?: string;
}

interface OpenWebUiTool {
	id?: string;
	name?: string;
	title?: string;
}

export interface OpenWebUiStatus {
	connected: boolean;
	message: string;
	model: string;
	model_available: boolean | null;
	available_models: string[];
	nocodb_tool_available: boolean | null;
	matched_tools: string[];
	tools_endpoint_available: boolean;
	models_endpoint_available: boolean;
	chat_completions_available: boolean;
}

function dedupe(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function extractNamedValue(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (!value || typeof value !== 'object') return null;

	const record = value as Record<string, unknown>;
	for (const key of ['title', 'name', 'id', 'url', 'source', 'label']) {
		const candidate = record[key];
		if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
	}

	return null;
}

function extractModelIds(payload: unknown): string[] {
	if (!payload || typeof payload !== 'object') return [];

	const record = payload as Record<string, unknown>;
	const rawModels = record.data ?? record.models ?? payload;
	if (!Array.isArray(rawModels)) return [];

	return dedupe(
		rawModels.flatMap((model) => {
			const typedModel = model as OpenWebUiModel | string;
			if (typeof typedModel === 'string') return typedModel;
			return [typedModel.id, typedModel.name].filter((value): value is string => Boolean(value));
		})
	);
}

function extractToolNames(payload: unknown): string[] {
	if (!payload || typeof payload !== 'object') return [];

	const record = payload as Record<string, unknown>;
	const rawTools = record.data ?? record.tools ?? payload;
	if (!Array.isArray(rawTools)) return [];

	return dedupe(
		rawTools.flatMap((tool) => {
			const typedTool = tool as OpenWebUiTool | string;
			if (typeof typedTool === 'string') return typedTool;
			return [typedTool.name, typedTool.title, typedTool.id].filter(
				(value): value is string => Boolean(value)
			);
		})
	);
}

function extractSources(payload: unknown, answer: string): string[] {
	const sources: string[] = [];
	if (payload && typeof payload === 'object') {
		const record = payload as Record<string, unknown>;
		for (const key of ['sources', 'citations', 'references']) {
			const entries = record[key];
			if (Array.isArray(entries)) {
				for (const entry of entries) {
					const value = extractNamedValue(entry);
					if (value) sources.push(value);
				}
			}
		}

		const toolCalls =
			(record.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message &&
			(((record.choices as Array<Record<string, unknown>>)[0].message as Record<string, unknown>)
				.tool_calls as Array<Record<string, unknown>> | undefined);

		if (Array.isArray(toolCalls)) {
			for (const toolCall of toolCalls) {
				const name = extractNamedValue(toolCall.function);
				if (name) sources.push(`tool:${name}`);
			}
		}
	}

	const sourceMatch = answer.match(/sources?:\s*(.+)$/im);
	if (sourceMatch) {
		const parsed = sourceMatch[1]
			.split(/[;,]/)
			.map((part) => part.trim())
			.filter(Boolean);
		sources.push(...parsed);
	}

	return dedupe(sources);
}

function buildHeaders(apiKey: string): HeadersInit {
	const headers: HeadersInit = {
		'Content-Type': 'application/json'
	};

	if (apiKey) {
		headers.Authorization = 'Bearer ' + apiKey;
	}

	return headers;
}

async function fetchOpenWebUiJson(url: string, apiKey: string, path: string): Promise<Response> {
	return fetch(`${url}${path}`, {
		method: 'GET',
		headers: buildHeaders(apiKey)
	});
}

export async function testOpenWebUiConnection(overrides?: {
	openWebUiUrl?: string;
	openWebUiApiKey?: string;
	openWebUiModel?: string;
}): Promise<OpenWebUiStatus> {
	const config = await getAiConfig();
	const openWebUiUrl = (overrides?.openWebUiUrl || config.openWebUiUrl).trim().replace(/\/+$/, '');
	const openWebUiApiKey = (overrides?.openWebUiApiKey ?? config.openWebUiApiKey).trim();
	const model = (overrides?.openWebUiModel || config.openWebUiModel).trim();

	if (!openWebUiUrl) {
		return {
			connected: false,
			message: 'Missing Open-WebUI URL.',
			model,
			model_available: null,
			available_models: [],
			nocodb_tool_available: null,
			matched_tools: [],
			tools_endpoint_available: false,
			models_endpoint_available: false,
			chat_completions_available: false
		};
	}

	if (!openWebUiApiKey) {
		return {
			connected: false,
			message: 'Missing Open-WebUI API key.',
			model,
			model_available: null,
			available_models: [],
			nocodb_tool_available: null,
			matched_tools: [],
			tools_endpoint_available: false,
			models_endpoint_available: false,
			chat_completions_available: false
		};
	}

	let modelsEndpointAvailable = false;
	let availableModels: string[] = [];
	let modelAvailable: boolean | null = null;
	let modelsMessage = '';

	try {
		const modelsResponse = await fetchOpenWebUiJson(openWebUiUrl, openWebUiApiKey, '/api/models');
		modelsEndpointAvailable = modelsResponse.ok;

		if (modelsResponse.ok) {
			const modelsPayload = await modelsResponse.json();
			availableModels = extractModelIds(modelsPayload);
			modelAvailable = availableModels.length > 0 ? availableModels.includes(model) : null;
		} else {
			modelsMessage = `Model lookup returned ${modelsResponse.status}.`;
		}
	} catch (error) {
		modelsMessage = error instanceof Error ? error.message : 'Model lookup failed.';
	}

	let toolsEndpointAvailable = false;
	let nocodbToolAvailable: boolean | null = null;
	let matchedTools: string[] = [];
	let toolsMessage = '';

	try {
		const toolsResponse = await fetchOpenWebUiJson(openWebUiUrl, openWebUiApiKey, '/api/v1/tools/');
		toolsEndpointAvailable = toolsResponse.ok;

		if (toolsResponse.ok) {
			const toolsPayload = await toolsResponse.json();
			const toolNames = extractToolNames(toolsPayload);
			matchedTools = toolNames.filter((toolName) =>
				toolName.toLowerCase().includes('nocodb-electrical') ||
				toolName.toLowerCase().includes('nocodb')
			);
			nocodbToolAvailable = matchedTools.some(
				(toolName) =>
					toolName.toLowerCase() === 'nocodb-electrical' ||
					toolName.toLowerCase().includes('nocodb-electrical')
			);
		} else {
			toolsMessage = `Tools lookup returned ${toolsResponse.status}.`;
		}
	} catch (error) {
		toolsMessage = error instanceof Error ? error.message : 'Tools lookup failed.';
	}

	// Actually test chat completions — this is what the app uses
	let chatCompletionsAvailable = false;
	let chatMessage = '';

	try {
		const chatResponse = await fetch(`${openWebUiUrl}/api/chat/completions`, {
			method: 'POST',
			headers: buildHeaders(openWebUiApiKey),
			body: JSON.stringify({
				model,
				messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
				max_tokens: 5
			})
		});
		chatCompletionsAvailable = chatResponse.ok;
		if (!chatResponse.ok) {
			const errBody = await chatResponse.text().catch(() => '');
			chatMessage = `Chat completions returned ${chatResponse.status}${errBody ? `: ${errBody}` : ''}.`;
		}
	} catch (error) {
		chatMessage = error instanceof Error ? error.message : 'Chat completions test failed.';
	}

	// The real test: can we actually run chat completions?
	const connected = chatCompletionsAvailable;
	if (!connected && !modelsEndpointAvailable && !toolsEndpointAvailable) {
		throw new Error(
			[chatMessage, modelsMessage, toolsMessage].filter(Boolean).join(' ') || 'Open-WebUI connection failed.'
		);
	}

	const statusMessage = !chatCompletionsAvailable
		? `Chat completions failed${chatMessage ? ` — ${chatMessage}` : ''}. AI chat will not work.`
		: nocodbToolAvailable === true
			? 'Connected — chat completions working and nocodb-electrical tool detected.'
			: modelAvailable === false
				? `Chat working, but model "${model}" was not found in models list.`
				: toolsEndpointAvailable
					? `Chat completions working. nocodb-electrical tool not detected.${modelsMessage ? ` ${modelsMessage}` : ''}`
					: `Chat completions working.${toolsMessage ? ` ${toolsMessage}` : ''}`;

	return {
		connected,
		message: statusMessage,
		model,
		model_available: modelAvailable,
		available_models: availableModels,
		nocodb_tool_available: nocodbToolAvailable,
		matched_tools: matchedTools,
		tools_endpoint_available: toolsEndpointAvailable,
		models_endpoint_available: modelsEndpointAvailable,
		chat_completions_available: chatCompletionsAvailable
	};
}

export async function askElectrical(question: string): Promise<AskElectricalResult> {
	const config = await getAiConfig();

	const resp = await fetch(`${config.openWebUiUrl}/api/chat/completions`, {
		method: 'POST',
		headers: buildHeaders(config.openWebUiApiKey),
		body: JSON.stringify({
			model: config.openWebUiModel,
			messages: [
				{
					role: 'system',
					content:
						'You are an electrical configuration assistant. Use the nocodb-electrical tools to look up data. Be specific with circuit numbers and panel names. Format responses concisely for mobile. If you reference a specific source, include a brief "Sources:" line.'
				},
				{ role: 'user', content: question }
			]
		})
	});

	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`Open-WebUI API error: ${resp.status} - ${text}`);
	}

	const data = await resp.json();
	const answer = data.choices?.[0]?.message?.content || 'No response generated.';

	return {
		answer,
		model: data.model || config.openWebUiModel,
		sources: extractSources(data, answer)
	};
}
