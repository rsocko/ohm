/**
 * Unit tests for provider construction (GitHub issue #129, revised per
 * issue #178 to collapse 'openwebui'/'openai'/'bifrost' into a single
 * generic 'openai-compatible' provider).
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
		compatibleUrl: 'http://bifrost:8080/v1',
		compatibleApiKey: '',
		compatibleModel: 'gpt-4o-mini',
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

	it('builds a generic openai-compatible provider against the configured gateway URL with a dummy key when none is set', async () => {
		const { getLlmProviderFromConfig } = await import('$lib/server/llm-provider');
		const result = getLlmProviderFromConfig(
			baseConfig({
				llmProvider: 'openai-compatible',
				compatibleUrl: 'http://bifrost:8080/v1',
				compatibleApiKey: '',
				compatibleModel: 'gpt-4o-mini'
			})
		);

		expect(result.providerName).toBe('openai-compatible');
		expect(result.modelId).toBe('gpt-4o-mini');
		// Resolves design doc open question #2 (API key passthrough): when the
		// user leaves the key blank (e.g. Bifrost manages backend auth
		// itself), the SDK still gets a non-empty placeholder.
		expect(createOpenAIMock).toHaveBeenCalledWith({
			baseURL: 'http://bifrost:8080/v1',
			apiKey: 'openai-compatible'
		});
	});

	it('passes through a user-configured API key for the openai-compatible provider', async () => {
		const { getLlmProviderFromConfig } = await import('$lib/server/llm-provider');
		const result = getLlmProviderFromConfig(
			baseConfig({
				llmProvider: 'openai-compatible',
				compatibleUrl: 'https://api.openai.com/v1',
				compatibleApiKey: 'sk-test',
				compatibleModel: 'gpt-4o'
			})
		);

		expect(result.providerName).toBe('openai-compatible');
		expect(result.modelId).toBe('gpt-4o');
		expect(createOpenAIMock).toHaveBeenCalledWith({
			baseURL: 'https://api.openai.com/v1',
			apiKey: 'sk-test'
		});
	});

	it('supports any OpenAI-wire-compatible URL shape (e.g. an Open-WebUI /api path)', async () => {
		const { getLlmProviderFromConfig } = await import('$lib/server/llm-provider');
		const result = getLlmProviderFromConfig(
			baseConfig({
				llmProvider: 'openai-compatible',
				compatibleUrl: 'http://open-webui.example.com/api',
				compatibleApiKey: 'owui-key',
				compatibleModel: 'gpt-4o'
			})
		);

		expect(result.providerName).toBe('openai-compatible');
		expect(createOpenAIMock).toHaveBeenCalledWith({
			baseURL: 'http://open-webui.example.com/api',
			apiKey: 'owui-key'
		});
	});
});

