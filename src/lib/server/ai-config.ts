import { env } from '$env/dynamic/private';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type LlmProvider = 'ollama' | 'openai-compatible';

/**
 * Legacy provider values from before the 'openai-compatible' consolidation
 * (see docs/bifrost-migration-design.md + issue #178 revision). 'openwebui',
 * 'openai', and 'bifrost' were previously distinct provider cases that only
 * differed in default URL/label — they're all OpenAI-wire-compatible
 * clients, so they're migrated to the single generic 'openai-compatible'
 * provider on read.
 */
type LegacyLlmProvider = 'openwebui' | 'openai' | 'bifrost';

export interface AiConfigFile {
	enabled?: boolean;
	llmProvider?: LlmProvider | LegacyLlmProvider;
	// Ollama settings
	ollamaUrl?: string;
	ollamaModel?: string;
	// Generic OpenAI-compatible settings (Bifrost, OpenAI, Open-WebUI,
	// LiteLLM, OpenRouter, or any other OpenAI-wire-compatible endpoint)
	compatibleUrl?: string;
	compatibleApiKey?: string;
	compatibleModel?: string;
	// Legacy per-provider fields — kept only so old saved configs can be
	// migrated to the fields above on read; never written going forward.
	openWebUiUrl?: string;
	openWebUiApiKey?: string;
	openWebUiModel?: string;
	openaiApiKey?: string;
	openaiModel?: string;
	bifrostUrl?: string;
	bifrostModel?: string;
	// Shared settings
	askApiKey?: string;
	askAuthRequired?: boolean;
	updatedAt?: string;
}

export interface AiConfig {
	enabled: boolean;
	llmProvider: LlmProvider;
	// Ollama settings
	ollamaUrl: string;
	ollamaModel: string;
	// Generic OpenAI-compatible settings (Bifrost, OpenAI, Open-WebUI,
	// LiteLLM, OpenRouter, or any other OpenAI-wire-compatible endpoint)
	compatibleUrl: string;
	compatibleApiKey: string;
	compatibleModel: string;
	// Shared settings
	askApiKey: string;
	askAuthRequired: boolean;
	updatedAt: string | null;
}

/**
 * Normalize a provider value read from disk/env, migrating legacy
 * 'openwebui'/'openai'/'bifrost' values to the generic 'openai-compatible'
 * provider. Returns undefined for unrecognized/missing values.
 */
function normalizeProvider(value: string | undefined): LlmProvider | undefined {
	if (value === 'ollama' || value === 'openai-compatible') return value;
	if (value === 'openwebui' || value === 'openai' || value === 'bifrost') return 'openai-compatible';
	return undefined;
}

const DEFAULT_LLM_PROVIDER: LlmProvider = normalizeProvider(env.LLM_PROVIDER) || 'ollama';
const DEFAULT_OLLAMA_URL = env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = env.OLLAMA_MODEL || 'qwen3:8b';
// Recommended default points at a Bifrost gateway (see
// docs/bifrost-migration-design.md), but this field works with any
// OpenAI-wire-compatible endpoint (OpenAI, Open-WebUI, LiteLLM, OpenRouter…).
const DEFAULT_COMPATIBLE_URL = env.OPENAI_COMPATIBLE_URL || 'http://bifrost:8080/v1';
const DEFAULT_COMPATIBLE_API_KEY = env.OPENAI_COMPATIBLE_API_KEY || '';
const DEFAULT_COMPATIBLE_MODEL = env.OPENAI_COMPATIBLE_MODEL || 'gpt-4o-mini';
const DEFAULT_ASK_API_KEY = env.ASK_API_KEY || '';

const AI_CONFIG_PATH = resolve(process.cwd(), 'data', 'ai-config.json');

// In-memory cache
let _cachedConfig: AiConfig | null = null;
let _cacheExpiry = 0;
const CACHE_TTL = 60_000;

function normalizeUrl(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

function generateAskApiKey(): string {
	return `eca_${randomBytes(24).toString('hex')}`;
}

async function ensureDataDirectory(): Promise<void> {
	await mkdir(dirname(AI_CONFIG_PATH), { recursive: true });
}

async function readAiConfigFile(): Promise<AiConfigFile> {
	try {
		const raw = await readFile(AI_CONFIG_PATH, 'utf8');
		return JSON.parse(raw) as AiConfigFile;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return {};
		}
		throw error;
	}
}

async function writeAiConfigFile(config: AiConfig): Promise<void> {
	await ensureDataDirectory();
	await writeFile(AI_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/**
 * Derive the generic 'openai-compatible' URL/key/model from a legacy
 * per-provider config, so switching to the new schema doesn't force
 * existing users to re-enter their settings. Only used when the new
 * `compatibleUrl` field hasn't been saved yet.
 */
function migrateLegacyCompatibleFields(fileConfig: AiConfigFile): {
	url?: string;
	apiKey?: string;
	model?: string;
} {
	switch (fileConfig.llmProvider) {
		case 'openwebui':
			// Old Open-WebUI case hit `${openWebUiUrl}/api`; preserve that path
			// so the migrated URL still points at the same endpoint.
			return {
				url: fileConfig.openWebUiUrl ? `${normalizeUrl(fileConfig.openWebUiUrl)}/api` : undefined,
				apiKey: fileConfig.openWebUiApiKey,
				model: fileConfig.openWebUiModel
			};
		case 'openai':
			// Old OpenAI case never set a baseURL (SDK default), so make that
			// explicit in the migrated generic field.
			return {
				url: 'https://api.openai.com/v1',
				apiKey: fileConfig.openaiApiKey,
				model: fileConfig.openaiModel
			};
		case 'bifrost':
			return {
				url: fileConfig.bifrostUrl,
				apiKey: '',
				model: fileConfig.bifrostModel
			};
		default:
			return {};
	}
}

function resolveConfig(fileConfig: AiConfigFile): AiConfig {
	const llmProvider = normalizeProvider(fileConfig.llmProvider) || DEFAULT_LLM_PROVIDER;

	const legacy =
		typeof fileConfig.compatibleUrl === 'undefined' ? migrateLegacyCompatibleFields(fileConfig) : {};

	return {
		enabled: fileConfig.enabled !== false, // default true
		llmProvider,
		ollamaUrl: normalizeUrl(fileConfig.ollamaUrl || DEFAULT_OLLAMA_URL),
		ollamaModel: (fileConfig.ollamaModel || DEFAULT_OLLAMA_MODEL).trim(),
		compatibleUrl: normalizeUrl(fileConfig.compatibleUrl ?? legacy.url ?? DEFAULT_COMPATIBLE_URL),
		compatibleApiKey: (fileConfig.compatibleApiKey ?? legacy.apiKey ?? DEFAULT_COMPATIBLE_API_KEY).trim(),
		compatibleModel: (fileConfig.compatibleModel ?? legacy.model ?? DEFAULT_COMPATIBLE_MODEL).trim(),
		askApiKey: (fileConfig.askApiKey || DEFAULT_ASK_API_KEY || generateAskApiKey()).trim(),
		askAuthRequired: fileConfig.askAuthRequired !== false, // default true
		updatedAt: fileConfig.updatedAt || null
	};
}

export async function getAiConfig(): Promise<AiConfig> {
	const now = Date.now();
	if (_cachedConfig && now < _cacheExpiry) return _cachedConfig;

	const fileConfig = await readAiConfigFile();
	const resolvedConfig = resolveConfig(fileConfig);

	// Bootstrap (and permanently migrate legacy schemas) whenever the file is
	// missing required new-schema fields — this also rewrites old
	// 'openwebui'/'openai'/'bifrost' configs into the generic schema so the
	// legacy fields are dropped from disk after the first read.
	const needsBootstrap =
		!fileConfig.llmProvider ||
		!fileConfig.ollamaUrl ||
		typeof fileConfig.compatibleUrl === 'undefined' ||
		!fileConfig.compatibleModel ||
		!fileConfig.askApiKey;

	if (needsBootstrap) {
		const bootstrappedConfig: AiConfig = {
			...resolvedConfig,
			updatedAt: resolvedConfig.updatedAt || new Date().toISOString()
		};
		await writeAiConfigFile(bootstrappedConfig);
		_cachedConfig = bootstrappedConfig;
		_cacheExpiry = now + CACHE_TTL;
		return bootstrappedConfig;
	}

	_cachedConfig = resolvedConfig;
	_cacheExpiry = now + CACHE_TTL;
	return resolvedConfig;
}

export async function saveAiConfig(
	input: Partial<AiConfigFile> & { regenerateAskApiKey?: boolean }
): Promise<AiConfig> {
	const currentConfig = await getAiConfig();

	const nextConfig: AiConfig = {
		enabled: input.enabled ?? currentConfig.enabled,
		llmProvider: normalizeProvider(input.llmProvider) ?? currentConfig.llmProvider,
		ollamaUrl: normalizeUrl(input.ollamaUrl ?? currentConfig.ollamaUrl),
		ollamaModel: (input.ollamaModel ?? currentConfig.ollamaModel).trim(),
		compatibleUrl: normalizeUrl(input.compatibleUrl ?? currentConfig.compatibleUrl),
		compatibleApiKey: (input.compatibleApiKey ?? currentConfig.compatibleApiKey).trim(),
		compatibleModel: (input.compatibleModel ?? currentConfig.compatibleModel).trim(),
		askApiKey: input.regenerateAskApiKey
			? generateAskApiKey()
			: (input.askApiKey ?? currentConfig.askApiKey).trim() || generateAskApiKey(),
		askAuthRequired: input.askAuthRequired ?? currentConfig.askAuthRequired,
		updatedAt: new Date().toISOString()
	};

	await writeAiConfigFile(nextConfig);
	_cachedConfig = null;
	_cacheExpiry = 0;
	return nextConfig;
}
