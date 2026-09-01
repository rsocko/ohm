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

		case 'openai-compatible':
		default:
			// Covers Bifrost, real OpenAI, Open-WebUI, LiteLLM, OpenRouter, or any
			// other endpoint that speaks the OpenAI chat-completions wire
			// protocol — the URL/key are whatever the user configured, with no
			// gateway-specific branching. Client-side there's no functional
			// difference between these backends; routing/failover/observability
			// (e.g. via Bifrost) all happen server-side, invisible to OHM.
			return {
				provider: createOpenAI({
					baseURL: config.compatibleUrl || undefined,
					apiKey: config.compatibleApiKey || 'openai-compatible' // SDK needs a non-empty string even if the backend doesn't require auth
				}),
				modelId: config.compatibleModel,
				providerName: 'openai-compatible'
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
