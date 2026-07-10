/**
 * Label Renderer — Canvas-based label generation
 * Renders panel directories and circuit labels from NocoDB V3Record data.
 * Output is used for both preview display and thermal printer bitmap.
 */

import type { RenderedLabel, PanelDirectoryTemplate, CircuitLabelTemplate } from './types';

interface V3Record {
	id: number;
	fields: Record<string, unknown>;
}

// --- Utility ---

function createCanvas(width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

function getBreakerType(circuit: V3Record): 'gfci' | 'afci' | 'dual' | 'standard' {
	const gfci = circuit.fields['GFCI Protected'] || circuit.fields.GFCI_Protected;
	const afci = circuit.fields['AFCI Protected'] || circuit.fields.AFCI_Protected;
	if (gfci && afci) return 'dual';
	if (gfci) return 'gfci';
	if (afci) return 'afci';
	return 'standard';
}

function breakerTypeLabel(type: 'gfci' | 'afci' | 'dual' | 'standard'): string {
	switch (type) {
		case 'gfci': return 'GFCI';
		case 'afci': return 'AFCI';
		case 'dual': return 'DF';
		default: return '';
	}
}

function breakerTypeColor(type: 'gfci' | 'afci' | 'dual' | 'standard'): string {
	switch (type) {
		case 'gfci': return '#22c55e';
		case 'afci': return '#3b82f6';
		case 'dual': return '#a855f7';
		default: return '#64748b';
	}
}

// --- Raster Conversion ---

/** Convert canvas to 1-bit monochrome raster data for thermal printing */
export function canvasToRaster(canvas: HTMLCanvasElement): { raster: Uint8Array; bytesPerLine: number } {
	const ctx = canvas.getContext('2d')!;
	const { width, height } = canvas;
	const imageData = ctx.getImageData(0, 0, width, height);
	const data = imageData.data;
	const bytesPerLine = Math.ceil(width / 8);
	const raster = new Uint8Array(bytesPerLine * height);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
			if (gray < 128) {
				raster[y * bytesPerLine + (x >> 3)] |= (0x80 >> (x % 8));
			}
		}
	}

	return { raster, bytesPerLine };
}

/**
 * Rotate a canvas 90° clockwise for D-series label printers.
 * The D30 print head feeds vertically, so a landscape label must be
 * rotated so the short edge (tape width) becomes the raster line width.
 */
export function rotateCanvas90CW(canvas: HTMLCanvasElement): HTMLCanvasElement {
	const rotated = document.createElement('canvas');
	rotated.width = canvas.height;
	rotated.height = canvas.width;
	const ctx = rotated.getContext('2d')!;
	ctx.translate(rotated.width / 2, rotated.height / 2);
	ctx.rotate(Math.PI / 2);
	ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
	return rotated;
}

/**
 * Scale and prepare a canvas for D30 printing.
 * The D30 has asymmetric resolution:
 * - Across print head (tape width): 8px/mm (203 DPI)
 * - Feed direction (label length): ~6.4px/mm (~163 DPI)
 *
 * If the source canvas was rendered via circuitTemplateFromConfig (which uses
 * D30_FEED_PPMM for width and D30_HEAD_PPMM for height), dimensions already
 * match the printer and only rotation is needed.
 *
 * For other canvases, this function scales to fit.
 *
 * @param canvas - Source canvas (landscape orientation, user-visible layout)
 * @param tapeWidthMm - Physical tape width in mm (12 or 15)
 * @param labelLengthMm - Label length in mm (0 = proportional from tape scaling)
 */
export function prepareCanvasForD30(
	canvas: HTMLCanvasElement,
	tapeWidthMm: number,
	labelLengthMm: number = 0
): HTMLCanvasElement {
	const headPPMM = 8;   // D30_HEAD_PPMM
	const feedPPMM = 6.4; // D30_FEED_PPMM

	// Raster line width: tape width at head DPI, byte-aligned
	const tapeWidthPx = Math.ceil(tapeWidthMm * headPPMM / 8) * 8;

	// Feed direction pixels
	let feedPx: number;
	if (labelLengthMm > 0) {
		feedPx = Math.round(labelLengthMm * feedPPMM);
	} else {
		// Proportional scaling based on aspect ratio
		const scale = tapeWidthPx / canvas.height;
		feedPx = Math.round(canvas.width * scale * (feedPPMM / headPPMM));
	}

	// Scale source canvas to target print dimensions
	const scaled = document.createElement('canvas');
	scaled.width = feedPx;       // feed direction (becomes height after rotation)
	scaled.height = tapeWidthPx; // tape width (becomes raster line width after rotation)
	const sctx = scaled.getContext('2d')!;
	sctx.fillStyle = '#ffffff';
	sctx.fillRect(0, 0, feedPx, tapeWidthPx);
	sctx.drawImage(canvas, 0, 0, feedPx, tapeWidthPx);

	// Rotate 90° CW
	const rotated = document.createElement('canvas');
	rotated.width = tapeWidthPx; // raster line width
	rotated.height = feedPx;     // feed lines
	const rctx = rotated.getContext('2d')!;
	rctx.translate(rotated.width / 2, rotated.height / 2);
	rctx.rotate(Math.PI / 2);
	rctx.drawImage(scaled, -scaled.width / 2, -scaled.height / 2);

	return rotated;
}

// --- Panel Directory Renderer ---

export function renderPanelDirectory(
	panel: V3Record,
	circuits: V3Record[],
	template: PanelDirectoryTemplate
): RenderedLabel {
	const { widthPx, fontSize, showAmps, showBreakerType, showDate } = template;

	const panelName = (panel.fields.Name as string) || 'Panel';
	const capacity = (panel.fields.Capacity as number) || 0;
	const location = (panel.fields['Home Name'] as string) || '';

	// Sort circuits by slot number
	const sorted = [...circuits].sort(
		(a, b) => ((a.fields.Number as number) || 99) - ((b.fields.Number as number) || 99)
	);

	// Calculate height based on circuit count
	const headerHeight = 48;
	const rowHeight = fontSize + 10;
	const maxSlot = Math.max(...sorted.map(c => (c.fields.Number as number) || 0), 0);
	const totalRows = Math.ceil(maxSlot / 2);
	const footerHeight = showDate ? 28 : 8;
	const height = headerHeight + (totalRows * rowHeight) + footerHeight;

	const canvas = createCanvas(widthPx, height);
	const ctx = canvas.getContext('2d')!;

	// White background
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, widthPx, height);

	// Header
	ctx.fillStyle = '#000000';
	ctx.font = `bold ${fontSize + 4}px "SF Mono", "Cascadia Code", "Courier New", monospace`;
	ctx.textAlign = 'center';
	ctx.fillText(panelName, widthPx / 2, 20);
	ctx.font = `${fontSize}px "SF Mono", "Courier New", monospace`;
	const subtitle = capacity ? `${capacity}A • ${location}` : location;
	ctx.fillText(subtitle, widthPx / 2, 36);

	// Divider line
	ctx.strokeStyle = '#000000';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(4, headerHeight - 4);
	ctx.lineTo(widthPx - 4, headerHeight - 4);
	ctx.stroke();

	// Center vertical divider
	const centerX = widthPx / 2;
	ctx.beginPath();
	ctx.moveTo(centerX, headerHeight);
	ctx.lineTo(centerX, headerHeight + totalRows * rowHeight);
	ctx.stroke();

	// Build circuit lookup by slot number
	const circuitBySlot = new Map<number, V3Record>();
	for (const circuit of sorted) {
		const slot = circuit.fields.Number as number;
		if (slot) circuitBySlot.set(slot, circuit);
	}

	// Render rows (odd=left, even=right)
	ctx.textAlign = 'left';
	const colWidth = (widthPx - 12) / 2;
	const leftX = 6;
	const rightX = centerX + 6;

	for (let row = 0; row < totalRows; row++) {
		const oddSlot = row * 2 + 1;
		const evenSlot = row * 2 + 2;
		const y = headerHeight + row * rowHeight + rowHeight - 2;

		const leftCircuit = circuitBySlot.get(oddSlot);
		if (leftCircuit) {
			drawCircuitRow(ctx, leftCircuit, leftX, y, colWidth - 8, fontSize, showAmps, showBreakerType);
		}

		const rightCircuit = circuitBySlot.get(evenSlot);
		if (rightCircuit) {
			drawCircuitRow(ctx, rightCircuit, rightX, y, colWidth - 8, fontSize, showAmps, showBreakerType);
		}
	}

	// Footer with date
	if (showDate) {
		ctx.fillStyle = '#666666';
		ctx.font = `${fontSize - 2}px sans-serif`;
		ctx.textAlign = 'center';
		const date = new Date().toISOString().split('T')[0];
		ctx.fillText(`Updated: ${date}`, widthPx / 2, height - 8);
	}

	// Border
	ctx.strokeStyle = '#000000';
	ctx.lineWidth = 2;
	ctx.strokeRect(1, 1, widthPx - 2, height - 2);

	const { raster, bytesPerLine } = canvasToRaster(canvas);
	return { canvas, width: widthPx, height, rasterData: raster, bytesPerLine };
}

function drawCircuitRow(
	ctx: CanvasRenderingContext2D,
	circuit: V3Record,
	x: number,
	y: number,
	maxWidth: number,
	fontSize: number,
	showAmps: boolean,
	showBreakerType: boolean
): void {
	const type = getBreakerType(circuit);
	const color = breakerTypeColor(type);
	const slot = circuit.fields.Number as number;
	const name = (circuit.fields.Name as string) || '';
	const amps = circuit.fields.Amps as number | undefined;

	// Color indicator bar
	ctx.fillStyle = color;
	ctx.fillRect(x, y - fontSize + 2, 3, fontSize);

	// Slot number
	ctx.fillStyle = '#000000';
	ctx.font = `bold ${fontSize}px "SF Mono", "Courier New", monospace`;
	const slotText = slot.toString().padStart(2, ' ');
	ctx.fillText(slotText, x + 6, y);

	// Circuit name + suffix
	ctx.font = `${fontSize}px sans-serif`;
	const nameX = x + 24;
	const availableWidth = maxWidth - 24;

	let suffix = '';
	if (showAmps && amps) suffix += ` ${amps}A`;
	if (showBreakerType && type !== 'standard') suffix += ` ${breakerTypeLabel(type)}`;

	let displayName = name;
	const fullText = displayName + suffix;
	if (ctx.measureText(fullText).width > availableWidth) {
		while (ctx.measureText(displayName + '…' + suffix).width > availableWidth && displayName.length > 3) {
			displayName = displayName.slice(0, -1);
		}
		ctx.fillText(displayName + '…' + suffix, nameX, y);
	} else {
		ctx.fillText(fullText, nameX, y);
	}
}

// --- Circuit Label Renderer ---

export function renderCircuitLabel(
	circuit: V3Record,
	panelName: string,
	template: CircuitLabelTemplate
): RenderedLabel {
	const { widthPx, heightPx, format } = template;
	const height = heightPx!;
	const canvas = createCanvas(widthPx, height);
	const ctx = canvas.getContext('2d')!;

	const slot = circuit.fields.Number as number;
	const name = (circuit.fields.Name as string) || '';
	const amps = circuit.fields.Amps as number | undefined;
	const type = getBreakerType(circuit);
	const typeStr = breakerTypeLabel(type);

	// White background
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, widthPx, height);

	// Scale font sizes relative to label height for legibility on any tape size
	// For 96px (12mm tape): primarySize ~28px, secondarySize ~20px
	// For 160px (20mm tape): primarySize ~48px, secondarySize ~32px
	const primarySize = Math.round(height * 0.30);
	const secondarySize = Math.round(height * 0.21);
	const padding = Math.round(height * 0.08);

	ctx.fillStyle = '#000000';
	ctx.textAlign = 'left';

	if (format === 'compact') {
		// Single-line: maximize text size, centered vertically
		const fontSize = Math.round(height * 0.38);
		ctx.font = `bold ${fontSize}px sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const line = `${slot} · ${panelName} · ${amps || '?'}A${typeStr ? ' ' + typeStr : ''}`;
		ctx.fillText(line, widthPx / 2, height / 2, widthPx - padding * 2);
	} else {
		// Two-line layout: circuit name large on top, details below
		// Line 1: Circuit name (bold, large — this is the most important info)
		ctx.font = `bold ${primarySize}px sans-serif`;
		ctx.textBaseline = 'alphabetic';
		const nameY = padding + primarySize;
		let displayName = name;
		const maxTextWidth = widthPx - padding * 2;
		while (ctx.measureText(displayName).width > maxTextWidth && displayName.length > 3) {
			displayName = displayName.slice(0, -1);
		}
		if (displayName.length < name.length) displayName += '…';
		ctx.fillText(displayName, padding, nameY, maxTextWidth);

		// Line 2: Panel · Ckt # · Amps · Type (secondary info)
		ctx.font = `${secondarySize}px sans-serif`;
		const detailY = nameY + secondarySize + Math.round(height * 0.06);
		const detail = `${panelName} · Ckt ${slot} · ${amps || '?'}A${typeStr ? ' · ' + typeStr : ''}`;
		ctx.fillText(detail, padding, detailY, maxTextWidth);
	}

	// Border
	ctx.strokeStyle = '#000000';
	ctx.lineWidth = 1;
	ctx.strokeRect(0.5, 0.5, widthPx - 1, height - 1);

	const { raster, bytesPerLine } = canvasToRaster(canvas);
	return { canvas, width: widthPx, height, rasterData: raster, bytesPerLine };
}
