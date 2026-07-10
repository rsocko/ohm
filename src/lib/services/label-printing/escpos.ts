/**
 * ESC/POS Command Builder
 * Generates byte sequences for Phomemo thermal printer commands.
 * Supports both receipt printers (M110/M120/T02) and label printers (D30/D35).
 */

const ESC = 0x1b;
const GS = 0x1d;

export function cmdInitialize(): Uint8Array {
	return new Uint8Array([ESC, 0x40]);
}

export function cmdSetDensity(level: number): Uint8Array {
	const clamped = Math.max(1, Math.min(8, level));
	return new Uint8Array([GS, 0x7c, clamped]);
}

export function cmdFeedDots(dots: number): Uint8Array {
	return new Uint8Array([ESC, 0x4a, dots & 0xff]);
}

/**
 * Print raster bit image (GS v 0)
 * @param raster - 1-bit monochrome bitmap data
 * @param bytesPerLine - width in bytes (widthPx / 8)
 * @param height - height in dots/pixels
 */
export function cmdRasterImage(
	raster: Uint8Array,
	bytesPerLine: number,
	height: number,
	mode: 0 | 1 | 2 | 3 = 0
): Uint8Array {
	const xL = bytesPerLine & 0xff;
	const xH = (bytesPerLine >> 8) & 0xff;
	const yL = height & 0xff;
	const yH = (height >> 8) & 0xff;

	const header = new Uint8Array([GS, 0x76, 0x30, mode, xL, xH, yL, yH]);
	const command = new Uint8Array(header.length + raster.length);
	command.set(header, 0);
	command.set(raster, header.length);
	return command;
}

/**
 * Build a complete print job for receipt printers (M110/M120/T02):
 * initialize → density → raster → feed
 */
export function buildPrintJob(
	raster: Uint8Array,
	bytesPerLine: number,
	height: number,
	density: number = 4
): Uint8Array {
	const parts = [
		cmdInitialize(),
		cmdSetDensity(density),
		cmdRasterImage(raster, bytesPerLine, height),
		cmdFeedDots(40),
	];

	const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
	const combined = new Uint8Array(totalLength);
	let offset = 0;
	for (const part of parts) {
		combined.set(part, offset);
		offset += part.length;
	}
	return combined;
}

// --- D30/D-series Label Printer Protocol ---

export type D30MediaType = 'gaps' | 'continuous' | 'marks';

/** D30 header: print speed + density + media type */
export function d30Header(mediaType: D30MediaType = 'gaps', density: number = 0x0f): Uint8Array {
	let mediaCode: number;
	switch (mediaType) {
		case 'gaps': mediaCode = 0x0a; break;
		case 'continuous': mediaCode = 0x0b; break;
		case 'marks': mediaCode = 0x26; break;
	}
	return new Uint8Array([
		0x1b, 0x4e, 0x0d, 0x05,  // Print speed (5 = fast)
		0x1b, 0x4e, 0x04, density & 0xff,  // Print density
		0x1f, 0x11, mediaCode,   // Media type
	]);
}

/**
 * D30 raster block marker (GS v 0).
 * D30 supports max 255 lines per block — caller must split larger images.
 */
export function d30BlockMarker(bytesPerRow: number, lines: number): Uint8Array {
	const blockLines = Math.min(lines, 255);
	return new Uint8Array([
		GS, 0x76, 0x30,             // GS v 0 - Print raster bit image
		0x00,                        // Mode: normal
		bytesPerRow & 0xff,          // Width low byte
		(bytesPerRow >> 8) & 0xff,   // Width high byte
		blockLines & 0xff,           // Height low byte
		(blockLines >> 8) & 0xff,    // Height high byte
	]);
}

/** D30 footer: end print job */
export function d30Footer(): Uint8Array {
	return new Uint8Array([
		0x1f, 0xf0, 0x05, 0x00,  // Phomemo end sequence 1
		0x1f, 0xf0, 0x03, 0x00,  // Phomemo end sequence 2
	]);
}

/**
 * A D30 print job is multi-step and requires delays between phases.
 * Returns the structured job for the Bluetooth service to send sequentially.
 */
export interface D30PrintJob {
	header: Uint8Array;
	/** Blocks of raster data, each with its own GS v 0 marker (max 255 lines each) */
	blocks: { marker: Uint8Array; data: Uint8Array }[];
	footer: Uint8Array;
}

export function buildD30PrintJob(
	raster: Uint8Array,
	bytesPerRow: number,
	totalHeight: number,
	mediaType: D30MediaType = 'gaps',
	density: number = 0x0f
): D30PrintJob {
	const MAX_LINES_PER_BLOCK = 255;
	const blocks: { marker: Uint8Array; data: Uint8Array }[] = [];

	let remainingLines = totalHeight;
	let currentLine = 0;

	while (remainingLines > 0) {
		const linesToSend = Math.min(remainingLines, MAX_LINES_PER_BLOCK);
		const marker = d30BlockMarker(bytesPerRow, linesToSend);
		const blockStart = currentLine * bytesPerRow;
		const blockSize = bytesPerRow * linesToSend;
		const data = raster.slice(blockStart, blockStart + blockSize);
		blocks.push({ marker, data });
		currentLine += linesToSend;
		remainingLines -= linesToSend;
	}

	return {
		header: d30Header(mediaType, density),
		blocks,
		footer: d30Footer(),
	};
}
