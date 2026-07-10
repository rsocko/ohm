import { getAiConfig, type AiConfig } from '$lib/server/ai-config';
import { getLlmProvider, getLlmProviderFromConfig } from '$lib/server/llm-provider';
import { generateText } from 'ai';

export interface AskElectricalResult {
	answer: string;
	model: string;
	sources: string[];
}

export interface LlmConnectionStatus {
	connected: boolean;
	message: string;
	provider: string;
	model: string;
	model_available: boolean | null;
	available_models: string[];
	chat_completions_available: boolean;
	// Open-WebUI specific (null for other providers)
	nocodb_tool_available: boolean | null;
	matched_tools: string[];
	tools_endpoint_available: boolean;
	models_endpoint_available: boolean;
}

function dedupe(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function extractSources(answer: string): string[] {
	const sources: string[] = [];
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

interface ModelEntry {
	id?: string;
	name?: string;
}

function extractModelIds(payload: unknown): string[] {
	if (!payload || typeof payload !== 'object') return [];

	const record = payload as Record<string, unknown>;
	const rawModels = record.data ?? record.models ?? payload;
	if (!Array.isArray(rawModels)) return [];

	return dedupe(
		rawModels.flatMap((model) => {
			const typedModel = model as ModelEntry | string;
			if (typeof typedModel === 'string') return typedModel;
			return [typedModel.id, typedModel.name].filter((value): value is string => Boolean(value));
		})
	);
}

interface ToolEntry {
	id?: string;
	name?: string;
	title?: string;
}

function extractToolNames(payload: unknown): string[] {
	if (!payload || typeof payload !== 'object') return [];

	const record = payload as Record<string, unknown>;
	const rawTools = record.data ?? record.tools ?? payload;
	if (!Array.isArray(rawTools)) return [];

	return dedupe(
		rawTools.flatMap((tool) => {
			const typedTool = tool as ToolEntry | string;
			if (typeof typedTool === 'string') return typedTool;
			return [typedTool.name, typedTool.title, typedTool.id].filter(
				(value): value is string => Boolean(value)
			);
		})
	);
}

/**
 * Test LLM connection — works with Ollama, OpenAI, or Open-WebUI.
 * For Ollama/OpenAI: tests the chat completions endpoint and models list.
 * For Open-WebUI: also checks tools endpoint for nocodb-electrical.
 */
export async function testLlmConnection(overrides?: Partial<AiConfig>): Promise<LlmConnectionStatus> {
	const config = await getAiConfig();
	const mergedConfig: AiConfig = { ...config, ...overrides } as AiConfig;
	const providerName = mergedConfig.llmProvider;

	// Determine the baseURL and model for the active provider
	let baseURL: string;
	let apiKey: string;
	let model: string;

	switch (providerName) {
		case 'ollama':
			baseURL = mergedConfig.ollamaUrl;
			apiKey = '';
			model = mergedConfig.ollamaModel;
			break;
		case 'openai':
			baseURL = 'https://api.openai.com';
			apiKey = mergedConfig.openaiApiKey;
			model = mergedConfig.openaiModel;
			break;
		case 'openwebui':
		default:
			baseURL = mergedConfig.openWebUiUrl;
			apiKey = mergedConfig.openWebUiApiKey;
			model = mergedConfig.openWebUiModel;
			break;
	}

	if (!baseURL) {
		return emptyStatus(providerName, model, `Missing ${providerName} URL.`);
	}

	if (providerName === 'openai' && !apiKey) {
		return emptyStatus(providerName, model, 'Missing OpenAI API key.');
	}

	if (providerName === 'openwebui' && !apiKey) {
		return emptyStatus(providerName, model, 'Missing Open-WebUI API key.');
	}

	// Test chat completions via the AI SDK
	let chatCompletionsAvailable = false;
	let chatMessage = '';

	try {
		const llmConfig = getLlmProviderFromConfig(mergedConfig);
		await generateText({
			model: llmConfig.provider.chat(llmConfig.modelId),
			prompt: 'Say "ok" and nothing else.',
			maxOutputTokens: 5
		});
		chatCompletionsAvailable = true;
	} catch (error) {
		chatMessage = error instanceof Error ? error.message : 'Chat completions test failed.';
	}

	// Test models endpoint
	let modelsEndpointAvailable = false;
	let availableModels: string[] = [];
	let modelAvailable: boolean | null = null;

	try {
		const modelsUrl = providerName === 'ollama'
			? `${baseURL}/v1/models`
			: providerName === 'openai'
				? 'https://api.openai.com/v1/models'
				: `${baseURL}/api/models`;

		const modelsResponse = await fetch(modelsUrl, {
			method: 'GET',
			headers: buildHeaders(apiKey)
		});
		modelsEndpointAvailable = modelsResponse.ok;

		if (modelsResponse.ok) {
			const modelsPayload = await modelsResponse.json();
			availableModels = extractModelIds(modelsPayload);
			modelAvailable = availableModels.length > 0 ? availableModels.includes(model) : null;
		}
	} catch {
		// Models endpoint is optional
	}

	// Open-WebUI specific: check tools endpoint
	let toolsEndpointAvailable = false;
	let nocodbToolAvailable: boolean | null = null;
	let matchedTools: string[] = [];

	if (providerName === 'openwebui') {
		try {
			const toolsResponse = await fetch(`${baseURL}/api/v1/tools/`, {
				method: 'GET',
				headers: buildHeaders(apiKey)
			});
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
			}
		} catch {
			// Tools endpoint is optional
		}
	}

	const connected = chatCompletionsAvailable;

	const providerLabel = providerName === 'ollama' ? 'Ollama'
		: providerName === 'openai' ? 'OpenAI'
			: 'Open-WebUI';

	let statusMessage: string;
	if (!connected) {
		statusMessage = `${providerLabel} chat completions failed${chatMessage ? ` — ${chatMessage}` : ''}. AI chat will not work.`;
	} else if (providerName === 'openwebui' && nocodbToolAvailable === true) {
		statusMessage = `Connected to ${providerLabel} — chat completions working and nocodb-electrical tool detected.`;
	} else if (modelAvailable === false) {
		statusMessage = `${providerLabel} chat working, but model "${model}" was not found in models list.`;
	} else {
		statusMessage = `${providerLabel} chat completions working.`;
	}

	return {
		connected,
		message: statusMessage,
		provider: providerName,
		model,
		model_available: modelAvailable,
		available_models: availableModels,
		chat_completions_available: chatCompletionsAvailable,
		nocodb_tool_available: nocodbToolAvailable,
		matched_tools: matchedTools,
		tools_endpoint_available: toolsEndpointAvailable,
		models_endpoint_available: modelsEndpointAvailable
	};
}

function emptyStatus(provider: string, model: string, message: string): LlmConnectionStatus {
	return {
		connected: false,
		message,
		provider,
		model,
		model_available: null,
		available_models: [],
		chat_completions_available: false,
		nocodb_tool_available: null,
		matched_tools: [],
		tools_endpoint_available: false,
		models_endpoint_available: false
	};
}

export async function askElectrical(question: string): Promise<AskElectricalResult> {
	const { provider, modelId } = await getLlmProvider();

	const result = await generateText({
		model: provider.chat(modelId),
		system:
			'You are an electrical configuration assistant. Use the nocodb-electrical tools to look up data. Be specific with circuit numbers and panel names. Format responses concisely for mobile. If you reference a specific source, include a brief "Sources:" line.',
		prompt: question,
	});

	return {
		answer: result.text || 'No response generated.',
		model: modelId,
		sources: extractSources(result.text || '')
	};
}
