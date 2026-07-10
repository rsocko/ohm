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
 * The D30 print head width is fixed by the tape size. After 90° rotation,
 * the raster line width (in pixels) MUST match the tape width in pixels,
 * otherwise the printer misinterprets the byte stream.
 *
 * This function:
 * 1. Scales the source canvas so its height = tapeWidthPx (becomes raster width after rotation)
 * 2. Rotates 90° clockwise
 * 3. Aligns the final width to a multiple of 8 (byte boundary)
 *
 * @param canvas - Source canvas (landscape orientation, user-visible layout)
 * @param tapeWidthMm - Physical tape width in mm (12 or 15)
 * @param pixelsPerMm - Printer resolution (default 8 = 203 DPI)
 */
export function prepareCanvasForD30(
	canvas: HTMLCanvasElement,
	tapeWidthMm: number,
	pixelsPerMm: number = 8
): HTMLCanvasElement {
	// Target height (becomes raster line width after rotation) must match tape
	const tapeWidthPx = Math.ceil(tapeWidthMm * pixelsPerMm / 8) * 8; // align to byte boundary

	// Scale factor to fit the canvas height into the tape width
	const scale = tapeWidthPx / canvas.height;

	// Scaled dimensions (before rotation)
	const scaledWidth = Math.round(canvas.width * scale);
	const scaledHeight = tapeWidthPx;

	// Create scaled canvas
	const scaled = document.createElement('canvas');
	scaled.width = scaledWidth;
	scaled.height = scaledHeight;
	const sctx = scaled.getContext('2d')!;
	// White background (thermal printers: white = no print)
	sctx.fillStyle = '#ffffff';
	sctx.fillRect(0, 0, scaledWidth, scaledHeight);
	sctx.drawImage(canvas, 0, 0, scaledWidth, scaledHeight);

	// Rotate 90° CW: width→height, height→width
	const rotated = document.createElement('canvas');
	rotated.width = scaledHeight; // tape width becomes raster line width
	rotated.height = scaledWidth; // label length becomes feed direction
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

	if (format === 'compact') {
		ctx.fillStyle = '#000000';
		ctx.font = 'bold 11px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const line = `Ckt ${slot} • ${panelName} • ${amps || '?'}A${typeStr ? ' ' + typeStr : ''}`;
		ctx.fillText(line, widthPx / 2, height / 2, widthPx - 12);
	} else {
		ctx.fillStyle = '#000000';
		ctx.font = 'bold 11px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(
			`Ckt ${slot} • ${panelName} • ${amps || '?'}A${typeStr ? ' ' + typeStr : ''}`,
			widthPx / 2, height * 0.35, widthPx - 12
		);
		ctx.font = '10px sans-serif';
		ctx.fillText(name, widthPx / 2, height * 0.7, widthPx - 12);
	}

	// Border
	ctx.strokeStyle = '#000000';
	ctx.lineWidth = 1;
	ctx.strokeRect(0.5, 0.5, widthPx - 1, height - 1);

	const { raster, bytesPerLine } = canvasToRaster(canvas);
	return { canvas, width: widthPx, height, rasterData: raster, bytesPerLine };
}
