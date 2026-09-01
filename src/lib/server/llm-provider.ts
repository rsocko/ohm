import { createOpenAI } from '@ai-sdk/openai';
import type { AiConfig, LlmProvider } from '$lib/server/ai-config';
import { getAiConfig } from '$lib/server/ai-config';

export interface LlmProviderConfig {
	provider: ReturnType<typeof createOpenAI>;
	modelId: string;
	providerName: LlmProvider;
}

/**
 * Build an AI SDK provider + model ID from the given config.
 * All backends speak the OpenAI chat-completions protocol,
 * so we use `createOpenAI` with the appropriate baseURL/apiKey.
 */
function buildProvider(config: AiConfig): LlmProviderConfig {
	switch (config.llmProvider) {
		case 'ollama':
			return {
				provider: createOpenAI({
					baseURL: `${config.ollamaUrl}/v1`,
					apiKey: 'ollama' // Ollama doesn't require a key but the SDK needs a non-empty string
				}),
				modelId: config.ollamaModel,
				providerName: 'ollama'
			};

		case 'openai':
			return {
				provider: createOpenAI({
					apiKey: config.openaiApiKey
				}),
				modelId: config.openaiModel,
				providerName: 'openai'
			};

		case 'bifrost':
			return {
				provider: createOpenAI({
					baseURL: config.bifrostUrl,
					apiKey: 'bifrost' // Bifrost manages backend auth; SDK just needs a non-empty string
				}),
				modelId: config.bifrostModel,
				providerName: 'bifrost'
			};

		case 'openwebui':
		default:
			return {
				provider: createOpenAI({
					baseURL: `${config.openWebUiUrl}/api`,
					apiKey: config.openWebUiApiKey
				}),
				modelId: config.openWebUiModel,
				providerName: 'openwebui'
			};
	}
}

/**
 * Get the LLM provider from the current config.
 * Returns a ready-to-use AI SDK provider, model ID, and provider name.
 */
export async function getLlmProvider(): Promise<LlmProviderConfig> {
	const config = await getAiConfig();
	return buildProvider(config);
}

/**
 * Build an LLM provider from explicit config (used by connection test with overrides).
 */
export function getLlmProviderFromConfig(config: AiConfig): LlmProviderConfig {
	return buildProvider(config);
}
