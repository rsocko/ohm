/**
 * Unit tests for the Bifrost provider option (GitHub issues #129/#130).
 *
 * `src/lib/server/ai-config.ts` reads `$env/dynamic/private` at import time
 * and persists a JSON cache file under `<cwd>/data/ai-config.json`, so each
 * test chdirs into a fresh temp directory and dynamically re-imports the
 * module (with `vi.resetModules()`) to get an isolated, uncached instance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ai-config bifrost support', () => {
	let tmpDir: string;
	let originalCwd: string;
	let originalBifrostUrl: string | undefined;
	let originalBifrostModel: string | undefined;
	let originalLlmProvider: string | undefined;

	beforeEach(() => {
		originalCwd = process.cwd();
		tmpDir = mkdtempSync(join(tmpdir(), 'ohm-ai-config-'));
		process.chdir(tmpDir);

		originalBifrostUrl = process.env.BIFROST_URL;
		originalBifrostModel = process.env.BIFROST_MODEL;
		originalLlmProvider = process.env.LLM_PROVIDER;
		delete process.env.BIFROST_URL;
		delete process.env.BIFROST_MODEL;
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

		if (originalBifrostUrl === undefined) delete process.env.BIFROST_URL;
		else process.env.BIFROST_URL = originalBifrostUrl;
		if (originalBifrostModel === undefined) delete process.env.BIFROST_MODEL;
		else process.env.BIFROST_MODEL = originalBifrostModel;
		if (originalLlmProvider === undefined) delete process.env.LLM_PROVIDER;
		else process.env.LLM_PROVIDER = originalLlmProvider;
	});

	it('includes bifrost in the LlmProvider defaults with sane fallback URL/model', async () => {
		const { getAiConfig } = await import('$lib/server/ai-config');
		const config = await getAiConfig();

		expect(config.bifrostUrl).toBe('https://bifrost.example.com/v1');
		expect(config.bifrostModel).toBe('gpt-4o-mini');
		// Existing providers still default correctly (backward compatibility).
		expect(config.llmProvider).toBe('ollama');
	});

	it('reads BIFROST_URL / BIFROST_MODEL env vars as defaults', async () => {
		process.env.BIFROST_URL = 'http://bifrost:8080/v1';
		process.env.BIFROST_MODEL = 'gpt-4o';
		process.env.LLM_PROVIDER = 'bifrost';

		const { getAiConfig } = await import('$lib/server/ai-config');
		const config = await getAiConfig();

		expect(config.llmProvider).toBe('bifrost');
		expect(config.bifrostUrl).toBe('http://bifrost:8080/v1');
		expect(config.bifrostModel).toBe('gpt-4o');
	});

	it('saveAiConfig persists bifrost fields, normalizing the URL', async () => {
		const { saveAiConfig } = await import('$lib/server/ai-config');

		const saved = await saveAiConfig({
			llmProvider: 'bifrost',
			bifrostUrl: 'http://bifrost:8080/v1/',
			bifrostModel: ' gpt-4o '
		});

		expect(saved.llmProvider).toBe('bifrost');
		expect(saved.bifrostUrl).toBe('http://bifrost:8080/v1');
		expect(saved.bifrostModel).toBe('gpt-4o');
	});

	it('switching back to ollama/openai after using bifrost still works', async () => {
		const { saveAiConfig } = await import('$lib/server/ai-config');

		await saveAiConfig({ llmProvider: 'bifrost', bifrostUrl: 'http://bifrost:8080/v1', bifrostModel: 'gpt-4o-mini' });
		const backToOllama = await saveAiConfig({ llmProvider: 'ollama' });

		expect(backToOllama.llmProvider).toBe('ollama');
		// Bifrost config is preserved (not wiped out) when switching away.
		expect(backToOllama.bifrostUrl).toBe('http://bifrost:8080/v1');
	});
});
