/**
 * Label Renderer — Canvas-based label generation
 * Renders panel directories and circuit labels from NocoDB V3Record data.
 * Output is used for both preview display and thermal printer bitmap.
 */

import type { RenderedLabel, PanelDirectoryTemplate, CircuitLabelTemplate, ReceptacleInfo } from './types';

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

function inferPoles(circuit: V3Record): number {
	const slot = (circuit.fields['Panel Slot'] as string) || '';
	if (slot.includes(',')) return 2;
	const amps = (circuit.fields.Amps as number) || 0;
	if (amps >= 30) return 2;
	return 1;
}

function isEnergyMonitored(circuit: V3Record): boolean {
	return Boolean(circuit.fields['Energy Monitored']);
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
	const headPPMM = 8; // D30_HEAD_PPMM
	const feedPPMM = 8; // D30_FEED_PPMM (uniform 203 DPI)

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
	template: PanelDirectoryTemplate,
	receptacles?: ReceptacleInfo[]
): RenderedLabel {
	const { widthPx, fontSize, showAmps, showBreakerType, showDate, showMonitored, showReceptacles } = template;

	const panelName = (panel.fields.Name as string) || 'Panel';
	const capacity = (panel.fields.Capacity as number) || 0;
	const location = (panel.fields['Home Name'] as string) || '';
	const serviceSize = (panel.fields['Service Size'] as string) || '';
	const isGeneratorBacked = Boolean(panel.fields['Generator Power']);

	// Sort circuits by slot number
	const sorted = [...circuits].sort(
		(a, b) => ((a.fields.Number as number) || 99) - ((b.fields.Number as number) || 99)
	);

	// Count occupied slots
	let slotsUsed = 0;
	for (const c of sorted) {
		slotsUsed += inferPoles(c);
	}

	// Build circuit lookup by slot number and detect 2-pole spans
	const circuitBySlot = new Map<number, V3Record>();
	const twoPoleSlots = new Set<number>(); // slots that are the START of a 2-pole
	const twoPoleSecondary = new Set<number>(); // slots consumed by the second pole
	for (const circuit of sorted) {
		const slot = circuit.fields.Number as number;
		if (!slot) continue;
		circuitBySlot.set(slot, circuit);
		if (inferPoles(circuit) === 2) {
			twoPoleSlots.add(slot);
			// 2-pole spans the next odd/even slot (same side, +2)
			twoPoleSecondary.add(slot + 2);
		}
	}

	// Calculate row layout
	const headerHeight = 54;
	const rowHeight = fontSize + 10;
	const maxSlot = Math.max(...sorted.map(c => (c.fields.Number as number) || 0), 0);
	const totalRows = Math.ceil(maxSlot / 2);

	// Calculate receptacle section height if needed
	let receptacleHeight = 0;
	const recsByCircuit = new Map<number, ReceptacleInfo[]>();
	if (showReceptacles && receptacles && receptacles.length > 0) {
		for (const r of receptacles) {
			const arr = recsByCircuit.get(r.circuitId) || [];
			arr.push(r);
			recsByCircuit.set(r.circuitId, arr);
		}
		// Each circuit with receptacles gets a sub-section
		for (const circuit of sorted) {
			const recs = recsByCircuit.get(circuit.id);
			if (recs && recs.length > 0) {
				receptacleHeight += (fontSize + 4) + Math.ceil(recs.length / 2) * (fontSize + 2);
			}
		}
		receptacleHeight += 16; // section header
	}

	const footerHeight = showDate ? 28 : 8;
	const height = headerHeight + (totalRows * rowHeight) + receptacleHeight + footerHeight;

	const canvas = createCanvas(widthPx, height);
	const ctx = canvas.getContext('2d')!;

	// White background
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, widthPx, height);

	// Header
	ctx.fillStyle = '#000000';
	ctx.font = `bold ${fontSize + 4}px "SF Mono", "Cascadia Code", "Courier New", monospace`;
	ctx.textAlign = 'center';

	// Panel name with generator indicator
	let headerText = panelName;
	if (isGeneratorBacked) headerText = `⚡ ${panelName} ⚡`;
	ctx.fillText(headerText, widthPx / 2, 20);

	// Subtitle: service size · circuits | slots · free · location
	ctx.font = `${fontSize}px "SF Mono", "Courier New", monospace`;
	const serviceSizeLabel = serviceSize ? `${serviceSize}A` : '';
	const slotsLabel = capacity ? `${slotsUsed}/${capacity} slots · ${Math.max(0, capacity - slotsUsed)} free` : `${slotsUsed} slots`;
	const subtitleParts = [serviceSizeLabel, `${sorted.length} ckts`, slotsLabel, location].filter(Boolean);
	ctx.fillText(subtitleParts.join(' · '), widthPx / 2, 36);

	// Generator indicator line
	if (isGeneratorBacked) {
		ctx.font = `bold ${fontSize - 1}px sans-serif`;
		ctx.fillStyle = '#666666';
		ctx.fillText('GENERATOR BACKED', widthPx / 2, 48);
		ctx.fillStyle = '#000000';
	}

	// Divider line
	ctx.strokeStyle = '#000000';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(4, headerHeight - 2);
	ctx.lineTo(widthPx - 4, headerHeight - 2);
	ctx.stroke();

	// Center vertical divider
	const centerX = widthPx / 2;
	ctx.beginPath();
	ctx.moveTo(centerX, headerHeight);
	ctx.lineTo(centerX, headerHeight + totalRows * rowHeight);
	ctx.stroke();

	// Render rows (odd=left, even=right) with 2-pole merged cells
	ctx.textAlign = 'left';
	const colWidth = (widthPx - 12) / 2;
	const leftX = 6;
	const rightX = centerX + 6;

	for (let row = 0; row < totalRows; row++) {
		const oddSlot = row * 2 + 1;
		const evenSlot = row * 2 + 2;
		const y = headerHeight + row * rowHeight + rowHeight - 2;

		// Left side (odd slots)
		if (twoPoleSecondary.has(oddSlot)) {
			// This slot is consumed by a 2-pole breaker from slot-2; draw continuation
			ctx.fillStyle = '#f0f0f0';
			ctx.fillRect(leftX, y - fontSize + 2, colWidth - 8, fontSize + 2);
			ctx.fillStyle = '#666666';
			ctx.font = `${fontSize - 1}px "SF Mono", "Courier New", monospace`;
			ctx.fillText(`  ${oddSlot}`, leftX + 4, y);
		} else {
			const leftCircuit = circuitBySlot.get(oddSlot);
			if (leftCircuit) {
				const is2Pole = twoPoleSlots.has(oddSlot);
				if (is2Pole) {
					// Draw merged background spanning 2 rows
					ctx.fillStyle = '#f8f8f8';
					ctx.fillRect(leftX, y - fontSize + 2, colWidth - 8, rowHeight * 2 - 2);
					ctx.fillStyle = '#000000';
				}
				drawCircuitRowEnhanced(ctx, leftCircuit, leftX, y, colWidth - 8, fontSize, showAmps, showBreakerType, showMonitored, is2Pole);
			}
		}

		// Right side (even slots)
		if (twoPoleSecondary.has(evenSlot)) {
			ctx.fillStyle = '#f0f0f0';
			ctx.fillRect(rightX, y - fontSize + 2, colWidth - 8, fontSize + 2);
			ctx.fillStyle = '#666666';
			ctx.font = `${fontSize - 1}px "SF Mono", "Courier New", monospace`;
			ctx.fillText(`  ${evenSlot}`, rightX + 4, y);
		} else {
			const rightCircuit = circuitBySlot.get(evenSlot);
			if (rightCircuit) {
				const is2Pole = twoPoleSlots.has(evenSlot);
				if (is2Pole) {
					ctx.fillStyle = '#f8f8f8';
					ctx.fillRect(rightX, y - fontSize + 2, colWidth - 8, rowHeight * 2 - 2);
					ctx.fillStyle = '#000000';
				}
				drawCircuitRowEnhanced(ctx, rightCircuit, rightX, y, colWidth - 8, fontSize, showAmps, showBreakerType, showMonitored, is2Pole);
			}
		}
	}

	// Receptacles section (detailed mode)
	if (showReceptacles && recsByCircuit.size > 0) {
		let recY = headerHeight + totalRows * rowHeight + 12;
		ctx.strokeStyle = '#000000';
		ctx.lineWidth = 0.5;
		ctx.beginPath();
		ctx.moveTo(4, recY - 6);
		ctx.lineTo(widthPx - 4, recY - 6);
		ctx.stroke();

		ctx.font = `bold ${fontSize}px sans-serif`;
		ctx.fillStyle = '#000000';
		ctx.textAlign = 'center';
		ctx.fillText('RECEPTACLES BY CIRCUIT', widthPx / 2, recY + 2);
		recY += fontSize + 8;

		ctx.textAlign = 'left';
		for (const circuit of sorted) {
			const recs = recsByCircuit.get(circuit.id);
			if (!recs || recs.length === 0) continue;

			const slot = circuit.fields.Number as number;
			const name = (circuit.fields.Name as string) || '';
			ctx.font = `bold ${fontSize}px sans-serif`;
			ctx.fillStyle = '#000000';
			ctx.fillText(`${slot} · ${name}`, leftX, recY);
			recY += fontSize + 2;

			ctx.font = `${fontSize - 1}px sans-serif`;
			ctx.fillStyle = '#444444';
			// Group by area
			const byArea = new Map<string, string[]>();
			for (const r of recs) {
				const area = r.area || 'Other';
				const arr = byArea.get(area) || [];
				arr.push(r.name);
				byArea.set(area, arr);
			}
			for (const [area, names] of byArea) {
				ctx.fillText(`  ${area}: ${names.join(', ')}`, leftX, recY);
				recY += fontSize + 2;
			}
			recY += 2;
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

function drawCircuitRowEnhanced(
	ctx: CanvasRenderingContext2D,
	circuit: V3Record,
	x: number,
	y: number,
	maxWidth: number,
	fontSize: number,
	showAmps: boolean,
	showBreakerType: boolean,
	showMonitored: boolean,
	is2Pole: boolean
): void {
	const type = getBreakerType(circuit);
	const color = breakerTypeColor(type);
	const slot = circuit.fields.Number as number;
	const name = (circuit.fields.Name as string) || '';
	const amps = circuit.fields.Amps as number | undefined;
	const monitored = isEnergyMonitored(circuit);

	// Color indicator bar (taller for 2-pole)
	ctx.fillStyle = color;
	const barHeight = is2Pole ? fontSize + 10 : fontSize;
	ctx.fillRect(x, y - fontSize + 2, 3, barHeight);

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
	if (showMonitored && monitored) suffix += ' ⚡';
	if (is2Pole) suffix += ' [2P]';

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
		// Single-line: number · name · amps (no panel, no "Ckt" prefix)
		// Compensate for D30 tape bias (~6px downward shift)
		const fontSize = Math.round(height * 0.38);
		ctx.font = `bold ${fontSize}px sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const verticalOffset = Math.round(height * 0.06);
		const line = `${slot} · ${name} · ${amps || '?'}A${typeStr ? ' ' + typeStr : ''}`;
		ctx.fillText(line, widthPx / 2, height / 2 + verticalOffset, widthPx - padding * 2);
	} else {
		// Two-line layout: name prominent on top, circuit details below
		// Vertically center with D30 offset
		const verticalOffset = Math.round(height * 0.06);
		const lineGap = Math.round(height * 0.04);
		const totalTextHeight = primarySize + secondarySize + lineGap;
		const startY = (height - totalTextHeight) / 2 + primarySize + verticalOffset;

		// Line 1: Circuit name (bold, large — most important info)
		ctx.font = `bold ${primarySize}px sans-serif`;
		ctx.textBaseline = 'alphabetic';
		let displayName = name;
		const maxTextWidth = widthPx - padding * 2;
		while (ctx.measureText(displayName).width > maxTextWidth && displayName.length > 3) {
			displayName = displayName.slice(0, -1);
		}
		if (displayName.length < name.length) displayName += '…';
		ctx.fillText(displayName, padding, startY, maxTextWidth);

		// Line 2: slot · amps · breaker type (no panel name, no "Ckt" prefix)
		ctx.font = `${secondarySize}px sans-serif`;
		const detailY = startY + secondarySize + lineGap;
		const detail = `${slot} · ${amps || '?'}A${typeStr ? ' · ' + typeStr : ''}`;
		ctx.fillText(detail, padding, detailY, maxTextWidth);
	}

	// No border — the D30's printable area doesn't reliably fit a full-bleed box

	const { raster, bytesPerLine } = canvasToRaster(canvas);
	return { canvas, width: widthPx, height, rasterData: raster, bytesPerLine };
}
