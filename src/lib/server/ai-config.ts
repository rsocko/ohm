import { env } from '$env/dynamic/private';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export type LlmProvider = 'ollama' | 'openwebui' | 'openai' | 'bifrost';

export interface AiConfigFile {
	enabled?: boolean;
	llmProvider?: LlmProvider;
	// Ollama settings
	ollamaUrl?: string;
	ollamaModel?: string;
	// Open-WebUI settings (legacy/fallback)
	openWebUiUrl?: string;
	openWebUiApiKey?: string;
	openWebUiModel?: string;
	// OpenAI settings
	openaiApiKey?: string;
	openaiModel?: string;
	// Bifrost settings (LLM gateway — routing, failover, observability)
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
	// Open-WebUI settings (legacy/fallback)
	openWebUiUrl: string;
	openWebUiApiKey: string;
	openWebUiModel: string;
	// OpenAI settings
	openaiApiKey: string;
	openaiModel: string;
	// Bifrost settings (LLM gateway — routing, failover, observability)
	bifrostUrl: string;
	bifrostModel: string;
	// Shared settings
	askApiKey: string;
	askAuthRequired: boolean;
	updatedAt: string | null;
}

const DEFAULT_LLM_PROVIDER: LlmProvider = (env.LLM_PROVIDER as LlmProvider) || 'ollama';
const DEFAULT_OLLAMA_URL = env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = env.OLLAMA_MODEL || 'qwen3:8b';
const DEFAULT_OPENWEBUI_URL = env.OPENWEBUI_URL || 'http://open-webui.example.com';
const DEFAULT_OPENWEBUI_API_KEY = env.OPENWEBUI_API_KEY || '';
const DEFAULT_OPENWEBUI_MODEL = env.OPENWEBUI_MODEL || 'gpt-4o';
const DEFAULT_OPENAI_API_KEY = env.OPENAI_API_KEY || '';
const DEFAULT_OPENAI_MODEL = env.OPENAI_MODEL || 'gpt-4o';
const DEFAULT_BIFROST_URL = env.BIFROST_URL || 'https://bifrost.example.com/v1';
const DEFAULT_BIFROST_MODEL = env.BIFROST_MODEL || 'gpt-4o-mini';
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

function resolveConfig(fileConfig: AiConfigFile): AiConfig {
	return {
		enabled: fileConfig.enabled !== false, // default true
		llmProvider: fileConfig.llmProvider || DEFAULT_LLM_PROVIDER,
		ollamaUrl: normalizeUrl(fileConfig.ollamaUrl || DEFAULT_OLLAMA_URL),
		ollamaModel: (fileConfig.ollamaModel || DEFAULT_OLLAMA_MODEL).trim(),
		openWebUiUrl: normalizeUrl(fileConfig.openWebUiUrl || DEFAULT_OPENWEBUI_URL),
		openWebUiApiKey: (fileConfig.openWebUiApiKey ?? DEFAULT_OPENWEBUI_API_KEY).trim(),
		openWebUiModel: (fileConfig.openWebUiModel || DEFAULT_OPENWEBUI_MODEL).trim(),
		openaiApiKey: (fileConfig.openaiApiKey ?? DEFAULT_OPENAI_API_KEY).trim(),
		openaiModel: (fileConfig.openaiModel || DEFAULT_OPENAI_MODEL).trim(),
		bifrostUrl: normalizeUrl(fileConfig.bifrostUrl || DEFAULT_BIFROST_URL),
		bifrostModel: (fileConfig.bifrostModel || DEFAULT_BIFROST_MODEL).trim(),
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

	const needsBootstrap =
		!fileConfig.llmProvider ||
		!fileConfig.ollamaUrl ||
		!fileConfig.openWebUiUrl ||
		typeof fileConfig.openWebUiApiKey === 'undefined' ||
		!fileConfig.openWebUiModel ||
		!fileConfig.bifrostUrl ||
		!fileConfig.bifrostModel ||
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
		llmProvider: input.llmProvider ?? currentConfig.llmProvider,
		ollamaUrl: normalizeUrl(input.ollamaUrl ?? currentConfig.ollamaUrl),
		ollamaModel: (input.ollamaModel ?? currentConfig.ollamaModel).trim(),
		openWebUiUrl: normalizeUrl(input.openWebUiUrl ?? currentConfig.openWebUiUrl),
		openWebUiApiKey: (input.openWebUiApiKey ?? currentConfig.openWebUiApiKey).trim(),
		openWebUiModel: (input.openWebUiModel ?? currentConfig.openWebUiModel).trim(),
		openaiApiKey: (input.openaiApiKey ?? currentConfig.openaiApiKey).trim(),
		openaiModel: (input.openaiModel ?? currentConfig.openaiModel).trim(),
		bifrostUrl: normalizeUrl(input.bifrostUrl ?? currentConfig.bifrostUrl),
		bifrostModel: (input.bifrostModel ?? currentConfig.bifrostModel).trim(),
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
