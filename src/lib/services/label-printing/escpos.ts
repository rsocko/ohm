/**
 * ESC/POS Command Builder
 * Generates byte sequences for Phomemo thermal printer commands.
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
 * Build a complete print job: initialize → density → raster → feed
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
