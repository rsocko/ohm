/**
 * Label Templates — Pre-configured sizes for Phomemo printers
 */

import type { PanelDirectoryTemplate, CircuitLabelTemplate, DeviceLabelTemplate, PrinterConfig } from './types';
import { getLabelDimensions } from './types';

/** Convert mm to pixels at given DPI */
export function mmToPx(mm: number, dpi: number): number {
	return Math.round((mm / 25.4) * dpi);
}

export const PANEL_DIRECTORY_40MM: PanelDirectoryTemplate = {
	type: 'panel-directory',
	widthMm: 40,
	heightMm: null,
	dpi: 203,
	widthPx: mmToPx(40, 203), // ~320px
	heightPx: null,
	showAmps: true,
	showBreakerType: true,
	showDate: true,
	fontSize: 9,
};

export const PANEL_DIRECTORY_50MM: PanelDirectoryTemplate = {
	type: 'panel-directory',
	widthMm: 50,
	heightMm: null,
	dpi: 203,
	widthPx: mmToPx(50, 203), // ~400px
	heightPx: null,
	showAmps: true,
	showBreakerType: true,
	showDate: true,
	fontSize: 10,
};

export const CIRCUIT_LABEL_COMPACT: CircuitLabelTemplate = {
	type: 'circuit',
	widthMm: 40,
	heightMm: 12,
	dpi: 203,
	widthPx: mmToPx(40, 203),
	heightPx: mmToPx(12, 203),
	format: 'compact',
	includeQr: false,
};

export const CIRCUIT_LABEL_DETAILED: CircuitLabelTemplate = {
	type: 'circuit',
	widthMm: 40,
	heightMm: 20,
	dpi: 203,
	widthPx: mmToPx(40, 203),
	heightPx: mmToPx(20, 203),
	format: 'detailed',
	includeQr: false,
};

export const DEVICE_LABEL: DeviceLabelTemplate = {
	type: 'device',
	widthMm: 40,
	heightMm: 12,
	dpi: 203,
	widthPx: mmToPx(40, 203),
	heightPx: mmToPx(12, 203),
	showPort: true,
	showVlan: true,
	showPoe: true,
};

// --- Dynamic template factories (from printer config) ---

/**
 * Create a circuit label template sized to match the printer's tape config.
 * Width = label length (feed direction), Height = tape width.
 */
export function circuitTemplateFromConfig(config: PrinterConfig, format: 'compact' | 'detailed' = 'compact'): CircuitLabelTemplate {
	const dims = getLabelDimensions(config);
	const dpi = config.dpi || 203;
	return {
		type: 'circuit',
		widthMm: dims.widthMm,
		heightMm: dims.heightMm,
		dpi,
		widthPx: mmToPx(dims.widthMm, dpi),
		heightPx: mmToPx(dims.heightMm, dpi),
		format,
		includeQr: false,
	};
}

/**
 * Create a panel directory template sized to the printer's label length.
 * Height is auto-calculated from content, but width matches the label.
 */
export function panelDirectoryTemplateFromConfig(config: PrinterConfig): PanelDirectoryTemplate {
	const dims = getLabelDimensions(config);
	const dpi = config.dpi || 203;
	return {
		type: 'panel-directory',
		widthMm: dims.widthMm,
		heightMm: null,
		dpi,
		widthPx: mmToPx(dims.widthMm, dpi),
		heightPx: null,
		showAmps: true,
		showBreakerType: true,
		showDate: true,
		fontSize: dims.heightMm <= 12 ? 8 : 9,
	};
}
