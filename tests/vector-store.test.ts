/**
 * Unit tests for embedding routing through the generic OpenAI-compatible
 * provider (GitHub issue #130, revised per issue #178 to collapse
 * 'openwebui'/'openai'/'bifrost' into a single generic provider).
 *
 * `db`, `ai` (embedMany/embed), and `@ai-sdk/openai` (createOpenAI) are all
 * mocked so the test can assert exactly which base URL / model the vector
 * store uses for embeddings once the compatible provider (e.g. Bifrost) is
 * active, without a live gateway or database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConfig } from '$lib/server/ai-config';

const createOpenAIMock = vi.fn();
const embeddingMock = vi.fn((modelId: string) => ({ __modelId: modelId }));
const embedManyMock = vi.fn(async ({ values }: { values: string[] }) => ({
	embeddings: values.map(() => [0.1, 0.2, 0.3])
}));

let mockConfig: AiConfig;

vi.mock('@ai-sdk/openai', () => ({
	createOpenAI: (opts: Record<string, unknown>) => {
		createOpenAIMock(opts);
		return { embedding: embeddingMock };
	}
}));

vi.mock('ai', () => ({
	embedMany: (args: { values: string[] }) => embedManyMock(args),
	embed: async () => ({ embedding: [0.1, 0.2, 0.3] })
}));

vi.mock('$lib/server/ai-config', () => ({
	getAiConfig: async () => mockConfig
}));

vi.mock('$lib/server/db', () => ({
	db: {
		getRooms: vi.fn(async () => [{ id: 1, name: 'Test Room', floor: 'Main', homeName: 'Test Home' }]),
		getPanels: vi.fn(async () => []),
		getCircuits: vi.fn(async () => []),
		getLoads: vi.fn(async () => []),
		getReceptacles: vi.fn(async () => [])
	}
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
	vi.resetModules();
	createOpenAIMock.mockClear();
	embeddingMock.mockClear();
	embedManyMock.mockClear();
});

describe('vector-store embeddings via the OpenAI-compatible provider', () => {
	it('routes embeddings through the gateway (e.g. Bifrost) when it is the active provider', async () => {
		mockConfig = baseConfig({ llmProvider: 'openai-compatible', compatibleApiKey: '' });

		const { reindex } = await import('$lib/server/vector-store');
		const result = await reindex();

		expect(result.documentCount).toBe(1);
		expect(createOpenAIMock).toHaveBeenCalledWith({
			baseURL: 'http://bifrost:8080/v1',
			apiKey: 'openai-compatible'
		});
		expect(embeddingMock).toHaveBeenCalledWith('text-embedding-3-small');
		expect(embedManyMock).toHaveBeenCalled();
	});

	it('passes through a user-configured API key when set on the compatible provider', async () => {
		mockConfig = baseConfig({
			llmProvider: 'openai-compatible',
			compatibleUrl: 'https://api.openai.com/v1',
			compatibleApiKey: 'sk-test'
		});

		const { reindex } = await import('$lib/server/vector-store');
		await reindex();

		expect(createOpenAIMock).toHaveBeenCalledWith({
			baseURL: 'https://api.openai.com/v1',
			apiKey: 'sk-test'
		});
	});

	it('falls back to Ollama for embeddings when the active provider is ollama', async () => {
		mockConfig = baseConfig({ llmProvider: 'ollama' });

		const { reindex } = await import('$lib/server/vector-store');
		await reindex();

		expect(createOpenAIMock).toHaveBeenCalledWith({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' });
		expect(embeddingMock).toHaveBeenCalledWith('nomic-embed-text');
	});

	it('surfaces (does not swallow) errors when the embedding call fails', async () => {
		mockConfig = baseConfig({ llmProvider: 'openai-compatible' });
		embedManyMock.mockRejectedValueOnce(new Error('Gateway embeddings endpoint unavailable'));

		const { reindex } = await import('$lib/server/vector-store');

		await expect(reindex()).rejects.toThrow('Gateway embeddings endpoint unavailable');
	});
});

