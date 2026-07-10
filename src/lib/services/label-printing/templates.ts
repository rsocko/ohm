/**
 * Label Templates — Pre-configured sizes for Phomemo printers
 */

import type { PanelDirectoryTemplate, CircuitLabelTemplate, DeviceLabelTemplate, PrinterConfig } from './types';
import { getLabelDimensions, D30_HEAD_PPMM, D30_FEED_PPMM } from './types';

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
	showMonitored: true,
	showReceptacles: false,
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
	showMonitored: true,
	showReceptacles: false,
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
 * For D-series (D30): uses asymmetric DPI so content is rendered at the
 * exact pixel dimensions the printer will consume — no distortion.
 *   Width (label length / feed direction): D30_FEED_PPMM (6.4 px/mm)
 *   Height (tape width / head direction): D30_HEAD_PPMM (8 px/mm)
 */
export function circuitTemplateFromConfig(config: PrinterConfig, format: 'compact' | 'detailed' = 'compact'): CircuitLabelTemplate {
	const dims = getLabelDimensions(config);
	// Use D30 native pixel densities so content fills correctly without distortion
	const widthPx = Math.round(dims.widthMm * D30_FEED_PPMM);
	const heightPx = Math.ceil(dims.heightMm * D30_HEAD_PPMM / 8) * 8; // byte-align height (becomes raster line width)
	return {
		type: 'circuit',
		widthMm: dims.widthMm,
		heightMm: dims.heightMm,
		dpi: config.dpi || 203,
		widthPx,
		heightPx,
		format,
		includeQr: false,
	};
}

/**
 * Create a panel directory template sized to the printer's label length.
 * Height is auto-calculated from content, but width matches the label.
 */
export function panelDirectoryTemplateFromConfig(config: PrinterConfig, options?: { catalogWidthMm?: number; catalogHeightMm?: number; showReceptacles?: boolean }): PanelDirectoryTemplate {
	const dims = getLabelDimensions(config);
	const widthPx = Math.round(dims.widthMm * D30_FEED_PPMM);
	return {
		type: 'panel-directory',
		widthMm: dims.widthMm,
		heightMm: null,
		dpi: config.dpi || 203,
		widthPx,
		heightPx: null,
		showAmps: true,
		showBreakerType: true,
		showDate: true,
		showMonitored: true,
		showReceptacles: options?.showReceptacles ?? false,
		fontSize: dims.heightMm <= 12 ? 8 : 9,
		catalogWidthMm: options?.catalogWidthMm,
		catalogHeightMm: options?.catalogHeightMm,
	};
}
