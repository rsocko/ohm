/**
 * Unit tests for the generic 'openai-compatible' provider option (GitHub
 * issues #129/#130, revised per issue #178 to collapse 'openwebui'/'openai'/
 * 'bifrost' into a single generic provider — see docs/bifrost-migration-design.md).
 *
 * `src/lib/server/ai-config.ts` reads `$env/dynamic/private` at import time
 * and persists a JSON cache file under `<cwd>/data/ai-config.json`, so each
 * test chdirs into a fresh temp directory and dynamically re-imports the
 * module (with `vi.resetModules()`) to get an isolated, uncached instance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ai-config openai-compatible provider', () => {
	let tmpDir: string;
	let originalCwd: string;
	let originalCompatibleUrl: string | undefined;
	let originalCompatibleModel: string | undefined;
	let originalLlmProvider: string | undefined;

	beforeEach(() => {
		originalCwd = process.cwd();
		tmpDir = mkdtempSync(join(tmpdir(), 'ohm-ai-config-'));
		process.chdir(tmpDir);

		originalCompatibleUrl = process.env.OPENAI_COMPATIBLE_URL;
		originalCompatibleModel = process.env.OPENAI_COMPATIBLE_MODEL;
		originalLlmProvider = process.env.LLM_PROVIDER;
		delete process.env.OPENAI_COMPATIBLE_URL;
		delete process.env.OPENAI_COMPATIBLE_MODEL;
		delete process.env.LLM_PROVIDER;

		// ai-config.ts computes its config file path (and env defaults) at
		// module load time, so force a fresh module instance per test —
		// otherwise later tests would reuse the first test's cached module,
		// still pointing at its now-deleted temp directory.
		vi.resetModules();
	});

	afterEach(() => {
		process.chdir(originalCwd);
		rmSync(tmpDir, { recursive: true, force: true });

		if (originalCompatibleUrl === undefined) delete process.env.OPENAI_COMPATIBLE_URL;
		else process.env.OPENAI_COMPATIBLE_URL = originalCompatibleUrl;
		if (originalCompatibleModel === undefined) delete process.env.OPENAI_COMPATIBLE_MODEL;
		else process.env.OPENAI_COMPATIBLE_MODEL = originalCompatibleModel;
		if (originalLlmProvider === undefined) delete process.env.LLM_PROVIDER;
		else process.env.LLM_PROVIDER = originalLlmProvider;
	});

	it('defaults to ollama with a Bifrost-recommended fallback URL/model for the compatible fields', async () => {
		const { getAiConfig } = await import('$lib/server/ai-config');
		const config = await getAiConfig();

		expect(config.llmProvider).toBe('ollama');
		// Recommended default points at a Bifrost gateway, per design doc.
		expect(config.compatibleUrl).toBe('http://bifrost:8080/v1');
		expect(config.compatibleModel).toBe('gpt-4o-mini');
	});

	it('reads OPENAI_COMPATIBLE_URL / OPENAI_COMPATIBLE_MODEL env vars as defaults', async () => {
		process.env.OPENAI_COMPATIBLE_URL = 'https://bifrost.example.com/v1';
		process.env.OPENAI_COMPATIBLE_MODEL = 'gpt-4o';
		process.env.LLM_PROVIDER = 'openai-compatible';

		const { getAiConfig } = await import('$lib/server/ai-config');
		const config = await getAiConfig();

		expect(config.llmProvider).toBe('openai-compatible');
		expect(config.compatibleUrl).toBe('https://bifrost.example.com/v1');
		expect(config.compatibleModel).toBe('gpt-4o');
	});

	it('saveAiConfig persists compatible fields, normalizing the URL', async () => {
		const { saveAiConfig } = await import('$lib/server/ai-config');

		const saved = await saveAiConfig({
			llmProvider: 'openai-compatible',
			compatibleUrl: 'http://bifrost:8080/v1/',
			compatibleModel: ' gpt-4o '
		});

		expect(saved.llmProvider).toBe('openai-compatible');
		expect(saved.compatibleUrl).toBe('http://bifrost:8080/v1');
		expect(saved.compatibleModel).toBe('gpt-4o');
	});

	it('switching back to ollama after using the compatible provider still works', async () => {
		const { saveAiConfig } = await import('$lib/server/ai-config');

		await saveAiConfig({
			llmProvider: 'openai-compatible',
			compatibleUrl: 'http://bifrost:8080/v1',
			compatibleModel: 'gpt-4o-mini'
		});
		const backToOllama = await saveAiConfig({ llmProvider: 'ollama' });

		expect(backToOllama.llmProvider).toBe('ollama');
		// Compatible-provider config is preserved (not wiped out) when switching away.
		expect(backToOllama.compatibleUrl).toBe('http://bifrost:8080/v1');
	});

	describe('legacy provider migration', () => {
		function writeLegacyConfig(fileConfig: Record<string, unknown>) {
			mkdirSync(join(tmpDir, 'data'), { recursive: true });
			writeFileSync(
				join(tmpDir, 'data', 'ai-config.json'),
				JSON.stringify(fileConfig, null, 2)
			);
		}

		it("migrates a legacy 'bifrost' config to 'openai-compatible', preserving its URL/model", async () => {
			writeLegacyConfig({
				llmProvider: 'bifrost',
				ollamaUrl: 'http://localhost:11434',
				ollamaModel: 'qwen3:8b',
				bifrostUrl: 'http://bifrost:8080/v1',
				bifrostModel: 'gpt-4o',
				askApiKey: 'eca_existing',
				updatedAt: '2024-01-01T00:00:00.000Z'
			});

			const { getAiConfig } = await import('$lib/server/ai-config');
			const config = await getAiConfig();

			expect(config.llmProvider).toBe('openai-compatible');
			expect(config.compatibleUrl).toBe('http://bifrost:8080/v1');
			expect(config.compatibleModel).toBe('gpt-4o');
			// Bifrost manages backend auth itself; legacy bifrost config never had a key.
			expect(config.compatibleApiKey).toBe('');
		});

		it("migrates a legacy 'openwebui' config to 'openai-compatible', preserving the /api path and API key", async () => {
			writeLegacyConfig({
				llmProvider: 'openwebui',
				ollamaUrl: 'http://localhost:11434',
				ollamaModel: 'qwen3:8b',
				openWebUiUrl: 'http://open-webui.example.com',
				openWebUiApiKey: 'owui-key',
				openWebUiModel: 'gpt-4o',
				askApiKey: 'eca_existing',
				updatedAt: '2024-01-01T00:00:00.000Z'
			});

			const { getAiConfig } = await import('$lib/server/ai-config');
			const config = await getAiConfig();

			expect(config.llmProvider).toBe('openai-compatible');
			expect(config.compatibleUrl).toBe('http://open-webui.example.com/api');
			expect(config.compatibleApiKey).toBe('owui-key');
			expect(config.compatibleModel).toBe('gpt-4o');
		});

		it("migrates a legacy 'openai' config to 'openai-compatible', defaulting to the OpenAI API base URL", async () => {
			writeLegacyConfig({
				llmProvider: 'openai',
				ollamaUrl: 'http://localhost:11434',
				ollamaModel: 'qwen3:8b',
				openaiApiKey: 'sk-existing',
				openaiModel: 'gpt-4o',
				askApiKey: 'eca_existing',
				updatedAt: '2024-01-01T00:00:00.000Z'
			});

			const { getAiConfig } = await import('$lib/server/ai-config');
			const config = await getAiConfig();

			expect(config.llmProvider).toBe('openai-compatible');
			expect(config.compatibleUrl).toBe('https://api.openai.com/v1');
			expect(config.compatibleApiKey).toBe('sk-existing');
			expect(config.compatibleModel).toBe('gpt-4o');
		});

		it('persists the migration to disk so legacy fields are dropped after the first read', async () => {
			writeLegacyConfig({
				llmProvider: 'bifrost',
				ollamaUrl: 'http://localhost:11434',
				ollamaModel: 'qwen3:8b',
				bifrostUrl: 'http://bifrost:8080/v1',
				bifrostModel: 'gpt-4o',
				askApiKey: 'eca_existing',
				updatedAt: '2024-01-01T00:00:00.000Z'
			});

			const { getAiConfig } = await import('$lib/server/ai-config');
			await getAiConfig();

			const persisted = JSON.parse(
				await import('node:fs/promises').then((fs) =>
					fs.readFile(join(tmpDir, 'data', 'ai-config.json'), 'utf8')
				)
			);

			expect(persisted.llmProvider).toBe('openai-compatible');
			expect(persisted.compatibleUrl).toBe('http://bifrost:8080/v1');
			expect(persisted.bifrostUrl).toBeUndefined();
		});
	});
});
