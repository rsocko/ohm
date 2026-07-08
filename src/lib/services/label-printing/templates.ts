/**
 * Label Templates — Pre-configured sizes for Phomemo printers
 */

import type { PanelDirectoryTemplate, CircuitLabelTemplate, DeviceLabelTemplate } from './types';

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
