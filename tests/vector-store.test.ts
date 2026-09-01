/**
 * Unit tests for embedding routing through Bifrost (GitHub issue #130).
 *
 * `db`, `ai` (embedMany/embed), and `@ai-sdk/openai` (createOpenAI) are all
 * mocked so the test can assert exactly which base URL / model the vector
 * store uses for embeddings once Bifrost is the active provider, without a
 * live gateway or database.
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
		openWebUiUrl: 'http://open-webui.example.com',
		openWebUiApiKey: 'owui-key',
		openWebUiModel: 'gpt-4o',
		openaiApiKey: '',
		openaiModel: 'gpt-4o',
		bifrostUrl: 'http://bifrost:8080/v1',
		bifrostModel: 'gpt-4o-mini',
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

describe('vector-store embeddings via Bifrost', () => {
	it('routes embeddings through the Bifrost gateway when it is the active provider', async () => {
		mockConfig = baseConfig({ llmProvider: 'bifrost' });

		const { reindex } = await import('$lib/server/vector-store');
		const result = await reindex();

		expect(result.documentCount).toBe(1);
		expect(createOpenAIMock).toHaveBeenCalledWith({ baseURL: 'http://bifrost:8080/v1', apiKey: 'bifrost' });
		expect(embeddingMock).toHaveBeenCalledWith('text-embedding-3-small');
		expect(embedManyMock).toHaveBeenCalled();
	});

	it('still prefers OpenAI when an API key is configured and provider is not bifrost', async () => {
		mockConfig = baseConfig({ llmProvider: 'ollama', openaiApiKey: 'sk-test' });

		const { reindex } = await import('$lib/server/vector-store');
		await reindex();

		expect(createOpenAIMock).toHaveBeenCalledWith({ apiKey: 'sk-test' });
	});

	it('falls back to Ollama for embeddings when no OpenAI key and provider is ollama', async () => {
		mockConfig = baseConfig({ llmProvider: 'ollama', openaiApiKey: '' });

		const { reindex } = await import('$lib/server/vector-store');
		await reindex();

		expect(createOpenAIMock).toHaveBeenCalledWith({ baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' });
		expect(embeddingMock).toHaveBeenCalledWith('nomic-embed-text');
	});

	it('surfaces (does not swallow) errors when the embedding call fails', async () => {
		mockConfig = baseConfig({ llmProvider: 'bifrost' });
		embedManyMock.mockRejectedValueOnce(new Error('Bifrost embeddings endpoint unavailable'));

		const { reindex } = await import('$lib/server/vector-store');

		await expect(reindex()).rejects.toThrow('Bifrost embeddings endpoint unavailable');
	});
});
