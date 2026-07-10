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
 * Transpose a canvas: swap width↔height so the image feeds correctly
 * on label printers (D30 etc.) where the narrow tape width is the
 * raster line width and the label length is the feed direction.
 *
 * Uses a matrix transpose (not a rotation) so text remains right-side-up
 * on the physical tape: pixel (x, y) → (y, x).
 */
export function transposeCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
	const transposed = document.createElement('canvas');
	transposed.width = canvas.height;
	transposed.height = canvas.width;
	const ctx = transposed.getContext('2d')!;
	// Matrix transpose: maps draw coordinate (x, y) to canvas pixel (y, x)
	ctx.transform(0, 1, 1, 0, 0, 0);
	ctx.drawImage(canvas, 0, 0);
	return transposed;
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
