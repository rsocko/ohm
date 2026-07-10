/**
 * Label Printing — Type Definitions
 * Interfaces for label data, templates, and printer configuration.
 * Works with the app's V3Record data shape from NocoDB.
 */

// --- Label Template Definitions ---

export type LabelType = 'panel-directory' | 'circuit' | 'device' | 'qr-combo';

export interface LabelTemplate {
	type: LabelType;
	/** Label width in mm */
	widthMm: number;
	/** Label height in mm (null = auto-calculated) */
	heightMm: number | null;
	/** Printer DPI (dots per inch) */
	dpi: number;
	/** Label width in pixels at configured DPI */
	widthPx: number;
	/** Label height in pixels (null = auto) */
	heightPx: number | null;
}

export interface PanelDirectoryTemplate extends LabelTemplate {
	type: 'panel-directory';
	showAmps: boolean;
	showBreakerType: boolean;
	showDate: boolean;
	fontSize: number;
}

export interface CircuitLabelTemplate extends LabelTemplate {
	type: 'circuit';
	format: 'compact' | 'detailed';
	includeQr: boolean;
}

export interface DeviceLabelTemplate extends LabelTemplate {
	type: 'device';
	showPort: boolean;
	showVlan: boolean;
	showPoe: boolean;
}

// --- Printer Configuration ---

/** D30-compatible tape sizes */
export type TapeWidth = 12 | 15;
export type LabelLength = 30 | 40 | 50 | 'continuous';

export interface TapeConfig {
	/** Physical tape width in mm (height of printed label) */
	tapeWidthMm: TapeWidth;
	/** Pre-cut label length in mm, or 'continuous' for roll tape */
	labelLengthMm: LabelLength;
}

export const D30_TAPE_OPTIONS: { label: string; config: TapeConfig }[] = [
	{ label: '12×30mm pre-cut', config: { tapeWidthMm: 12, labelLengthMm: 30 } },
	{ label: '12×40mm pre-cut', config: { tapeWidthMm: 12, labelLengthMm: 40 } },
	{ label: '14×30mm pre-cut', config: { tapeWidthMm: 14 as TapeWidth, labelLengthMm: 30 } },
	{ label: '15×30mm pre-cut', config: { tapeWidthMm: 15, labelLengthMm: 30 } },
	{ label: '15mm continuous', config: { tapeWidthMm: 15, labelLengthMm: 'continuous' } },
];

export interface PrinterConfig {
	deviceName: string | null;
	/** @deprecated Use tapeWidthMm/labelLengthMm instead */
	labelWidthMm: number;
	/** Physical tape width (label height) in mm */
	tapeWidthMm: TapeWidth;
	/** Pre-cut label length (label width) or 'continuous' */
	labelLengthMm: LabelLength;
	dpi: number;
	/** Print density (1-8, higher = darker) */
	density: number;
	serviceUuid: string;
	writeCharUuid: string;
	/** Chunk size for BLE writes (bytes) */
	chunkSize: number;
	/** Delay between chunks (ms) */
	chunkDelayMs: number;
}

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
	deviceName: null,
	labelWidthMm: 40,
	tapeWidthMm: 15,
	labelLengthMm: 'continuous',
	dpi: 203,
	density: 4,
	serviceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
	writeCharUuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
	chunkSize: 128,
	chunkDelayMs: 20,
};

/**
 * D30 resolution constants (empirically determined).
 * The D30 has asymmetric resolution:
 * - Across the print head (tape width direction): 8 px/mm (203 DPI)
 * - Feed direction (label length): ~6.4 px/mm (~163 DPI)
 *   Measured: 160 feed lines = 25mm physical → 6.4 px/mm
 */
export const D30_HEAD_PPMM = 8;    // pixels per mm across print head
export const D30_FEED_PPMM = 6.4;  // pixels per mm in feed direction

/** Get label dimensions in mm from config (width = length, height = tape width) */
export function getLabelDimensions(config: PrinterConfig): { widthMm: number; heightMm: number } {
	const heightMm = config.tapeWidthMm;
	const widthMm = config.labelLengthMm === 'continuous' ? 50 : config.labelLengthMm;
	return { widthMm, heightMm };
}

// --- Label Render Output ---

export interface RenderedLabel {
	canvas: HTMLCanvasElement;
	width: number;
	height: number;
	/** Physical label width in mm */
	widthMm?: number;
	/** Physical label height in mm */
	heightMm?: number;
	rasterData?: Uint8Array;
	bytesPerLine?: number;
}

/**
 * Known BLE service/characteristic UUID pairs for Phomemo printers.
 * Different models expose different services; we try each in order.
 * notifyCharUuid is used to subscribe to printer status notifications.
 */
export const KNOWN_PRINTER_PROFILES: { serviceUuid: string; writeCharUuid: string; notifyCharUuid: string }[] = [
	{ serviceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb', writeCharUuid: '0000ffe1-0000-1000-8000-00805f9b34fb', notifyCharUuid: '0000ffe1-0000-1000-8000-00805f9b34fb' },
	{ serviceUuid: '0000ff00-0000-1000-8000-00805f9b34fb', writeCharUuid: '0000ff02-0000-1000-8000-00805f9b34fb', notifyCharUuid: '0000ff01-0000-1000-8000-00805f9b34fb' },
	{ serviceUuid: '0000ae30-0000-1000-8000-00805f9b34fb', writeCharUuid: '0000ae01-0000-1000-8000-00805f9b34fb', notifyCharUuid: '0000ae02-0000-1000-8000-00805f9b34fb' },
	{ serviceUuid: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', writeCharUuid: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f', notifyCharUuid: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f' },
];

// --- Printer Status ---

/** Printer status decoded from notify characteristic responses */
export type PrinterStatus = 'idle' | 'printing' | 'paper-out' | 'cover-open' | 'overheated' | 'low-battery' | 'unknown-error';

export interface PrinterStatusEvent {
	status: PrinterStatus;
	raw: Uint8Array;
	timestamp: number;
}

// --- Bluetooth State ---

export type BluetoothState =
	| 'unavailable'
	| 'disconnected'
	| 'connecting'
	| 'connected'
	| 'printing'
	| 'error';

export interface PrinterState {
	bluetooth: BluetoothState;
	deviceName: string | null;
	printerStatus: PrinterStatus;
}
