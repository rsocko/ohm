import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DEFAULT_PRINTER_CONFIG, type PrinterConfig, type TapeWidth, type LabelLength } from '$lib/services/label-printing/types';

export type DefaultCircuitFormat = 'compact' | 'detailed';

export interface PrinterConfigFile extends Partial<PrinterConfig> {
	defaultLabelSize?: string;
	defaultCircuitFormat?: DefaultCircuitFormat;
	updatedAt?: string;
}

export interface SavedPrinterConfig extends PrinterConfig {
	defaultCircuitFormat: DefaultCircuitFormat;
	updatedAt: string | null;
}

const PRINTER_CONFIG_PATH = resolve(process.cwd(), 'data', 'printer-config.json');

// In-memory cache
let _cachedConfig: SavedPrinterConfig | null = null;
let _cacheExpiry = 0;
const CACHE_TTL = 60_000;

function normalizeTapeWidth(value: number | undefined): TapeWidth {
	if (value === 12) return 12;
	return 15; // default to 15mm
}

function normalizeLabelLength(value: string | number | undefined): LabelLength {
	if (value === 'continuous') return 'continuous';
	const num = Number(value);
	if (num === 30) return 30;
	if (num === 40) return 40;
	if (num === 50) return 50;
	return 'continuous'; // default
}

function normalizeCircuitFormat(value: DefaultCircuitFormat | undefined): DefaultCircuitFormat {
	return value === 'detailed' ? 'detailed' : 'compact';
}

function normalizeDensity(value: number | undefined): number {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		return DEFAULT_PRINTER_CONFIG.density;
	}

	return Math.min(8, Math.max(1, Math.round(value)));
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		return fallback;
	}

	return Math.max(1, Math.round(value));
}

async function ensureDataDirectory(): Promise<void> {
	await mkdir(dirname(PRINTER_CONFIG_PATH), { recursive: true });
}

async function readPrinterConfigFile(): Promise<PrinterConfigFile> {
	try {
		const raw = await readFile(PRINTER_CONFIG_PATH, 'utf8');
		return JSON.parse(raw) as PrinterConfigFile;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return {};
		}

		throw error;
	}
}

async function writePrinterConfigFile(config: SavedPrinterConfig): Promise<void> {
	await ensureDataDirectory();
	await writeFile(PRINTER_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function resolvePrinterConfig(fileConfig: PrinterConfigFile): SavedPrinterConfig {
	const tapeWidthMm = normalizeTapeWidth(fileConfig.tapeWidthMm);
	const labelLengthMm = normalizeLabelLength(fileConfig.labelLengthMm);

	return {
		deviceName: fileConfig.deviceName || DEFAULT_PRINTER_CONFIG.deviceName,
		labelWidthMm: labelLengthMm === 'continuous' ? 50 : labelLengthMm,
		tapeWidthMm,
		labelLengthMm,
		dpi: DEFAULT_PRINTER_CONFIG.dpi,
		density: normalizeDensity(fileConfig.density),
		serviceUuid: (fileConfig.serviceUuid || DEFAULT_PRINTER_CONFIG.serviceUuid).trim(),
		writeCharUuid: (fileConfig.writeCharUuid || DEFAULT_PRINTER_CONFIG.writeCharUuid).trim(),
		chunkSize: normalizePositiveInteger(fileConfig.chunkSize, DEFAULT_PRINTER_CONFIG.chunkSize),
		chunkDelayMs: normalizePositiveInteger(fileConfig.chunkDelayMs, DEFAULT_PRINTER_CONFIG.chunkDelayMs),
		defaultCircuitFormat: normalizeCircuitFormat(fileConfig.defaultCircuitFormat),
		updatedAt: fileConfig.updatedAt || null
	};
}

export async function getPrinterConfig(): Promise<SavedPrinterConfig> {
	const now = Date.now();
	if (_cachedConfig && now < _cacheExpiry) return _cachedConfig;

	const fileConfig = await readPrinterConfigFile();
	const resolvedConfig = resolvePrinterConfig(fileConfig);

	const needsBootstrap =
		typeof fileConfig.tapeWidthMm === 'undefined' ||
		typeof fileConfig.density === 'undefined' ||
		!fileConfig.serviceUuid ||
		!fileConfig.writeCharUuid ||
		!fileConfig.defaultCircuitFormat;

	if (needsBootstrap) {
		const bootstrappedConfig: SavedPrinterConfig = {
			...resolvedConfig,
			updatedAt: resolvedConfig.updatedAt || new Date().toISOString()
		};
		await writePrinterConfigFile(bootstrappedConfig);
		_cachedConfig = bootstrappedConfig;
		_cacheExpiry = now + CACHE_TTL;
		return bootstrappedConfig;
	}

	_cachedConfig = resolvedConfig;
	_cacheExpiry = now + CACHE_TTL;
	return resolvedConfig;
}

export async function savePrinterConfig(input: Partial<PrinterConfigFile>): Promise<SavedPrinterConfig> {
	const currentConfig = await getPrinterConfig();
	const tapeWidthMm = normalizeTapeWidth(input.tapeWidthMm ?? currentConfig.tapeWidthMm);
	const labelLengthMm = normalizeLabelLength(input.labelLengthMm ?? currentConfig.labelLengthMm);

	const nextConfig: SavedPrinterConfig = {
		deviceName: typeof input.deviceName === 'undefined' ? currentConfig.deviceName : input.deviceName,
		labelWidthMm: labelLengthMm === 'continuous' ? 50 : labelLengthMm,
		tapeWidthMm,
		labelLengthMm,
		dpi: DEFAULT_PRINTER_CONFIG.dpi,
		density: normalizeDensity(input.density ?? currentConfig.density),
		serviceUuid: (input.serviceUuid ?? currentConfig.serviceUuid).trim(),
		writeCharUuid: (input.writeCharUuid ?? currentConfig.writeCharUuid).trim(),
		chunkSize: normalizePositiveInteger(input.chunkSize ?? currentConfig.chunkSize, currentConfig.chunkSize),
		chunkDelayMs: normalizePositiveInteger(
			input.chunkDelayMs ?? currentConfig.chunkDelayMs,
			currentConfig.chunkDelayMs
		),
		defaultCircuitFormat: normalizeCircuitFormat(input.defaultCircuitFormat ?? currentConfig.defaultCircuitFormat),
		updatedAt: new Date().toISOString()
	};

	await writePrinterConfigFile(nextConfig);
	_cachedConfig = null;
	_cacheExpiry = 0;
	return nextConfig;
}
