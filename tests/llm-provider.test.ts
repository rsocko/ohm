/**
 * Unit tests for provider construction (GitHub issue #129).
 *
 * `createOpenAI` is mocked so we can assert exactly which baseURL/apiKey
 * each provider case is built with, without making real network calls.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '$lib/server/ai-config';

const createOpenAIMock = vi.fn((opts: Record<string, unknown>) => ({ __opts: opts }));

vi.mock('@ai-sdk/openai', () => ({
	createOpenAI: (opts: Record<string, unknown>) => createOpenAIMock(opts)
}));

function baseConfig(overrides: Partial<AiConfig> = {}): AiConfig {
	return {
		enabled: true,
		llmProvider: 'ollama',
		ollamaUrl: 'http://localhost:11434',
		ollamaModel: 'qwen3:8b',
		openWebUiUrl: 'http://open-webui.example.com',
		openWebUiApiKey: 'owui-key',
		openWebUiModel: 'gpt-4o',
		openaiApiKey: 'sk-test',
		openaiModel: 'gpt-4o',
		bifrostUrl: 'https://bifrost.example.com/v1',
		bifrostModel: 'gpt-4o-mini',
		askApiKey: 'eca_test',
		askAuthRequired: true,
		updatedAt: null,
		...overrides
	};
}

beforeEach(() => {
	createOpenAIMock.mockClear();
});

describe('getLlmProviderFromConfig', () => {
	it('builds an ollama provider against the local /v1 endpoint', async () => {
		const { getLlmProviderFromConfig } = await import('$lib/server/llm-provider');
		const result = getLlmProviderFromConfig(baseConfig({ llmProvider: 'ollama' }));

		expect(result.providerName).toBe('ollama');
		expect(result.modelId).toBe('qwen3:8b');
		expect(createOpenAIMock).toHaveBeenCalledWith({
			baseURL: 'http://localhost:11434/v1',
			apiKey: 'ollama'
		});
	});

	it('builds an openai provider against the default OpenAI endpoint', async () => {
		const { getLlmProviderFromConfig } = await import('$lib/server/llm-provider');
		const result = getLlmProviderFromConfig(baseConfig({ llmProvider: 'openai' }));

		expect(result.providerName).toBe('openai');
		expect(result.modelId).toBe('gpt-4o');
		expect(createOpenAIMock).toHaveBeenCalledWith({ apiKey: 'sk-test' });
	});

	it('builds an openwebui provider against its /api path', async () => {
		const { getLlmProviderFromConfig } = await import('$lib/server/llm-provider');
		const result = getLlmProviderFromConfig(baseConfig({ llmProvider: 'openwebui' }));

		expect(result.providerName).toBe('openwebui');
		expect(result.modelId).toBe('gpt-4o');
		expect(createOpenAIMock).toHaveBeenCalledWith({
			baseURL: 'http://open-webui.example.com/api',
			apiKey: 'owui-key'
		});
	});

	it('builds a bifrost provider against the gateway URL with a dummy API key', async () => {
		const { getLlmProviderFromConfig } = await import('$lib/server/llm-provider');
		const result = getLlmProviderFromConfig(
			baseConfig({ llmProvider: 'bifrost', bifrostUrl: 'http://bifrost:8080/v1', bifrostModel: 'gpt-4o-mini' })
		);

		expect(result.providerName).toBe('bifrost');
		expect(result.modelId).toBe('gpt-4o-mini');
		// Bifrost manages backend auth itself (no client-side key needed), so
		// the SDK just gets a non-empty placeholder — resolves design doc
		// open question #2 (API key passthrough).
		expect(createOpenAIMock).toHaveBeenCalledWith({
			baseURL: 'http://bifrost:8080/v1',
			apiKey: 'bifrost'
		});
	});

	it('supports the external bifrost URL form too', async () => {
		const { getLlmProviderFromConfig } = await import('$lib/server/llm-provider');
		const result = getLlmProviderFromConfig(
			baseConfig({ llmProvider: 'bifrost', bifrostUrl: 'https://bifrost.example.com/v1' })
		);

		expect(result.providerName).toBe('bifrost');
		expect(createOpenAIMock).toHaveBeenCalledWith({
			baseURL: 'https://bifrost.example.com/v1',
			apiKey: 'bifrost'
		});
	});
});
