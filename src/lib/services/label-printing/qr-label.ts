/**
 * QR Combo Label Renderer
 * Generates labels with a QR code + text for circuit/device identification.
 * QR links to the app's circuit detail page for quick mobile access.
 */

import QRCode from 'qrcode';
import type { RenderedLabel } from './types';
import { mmToPx } from './templates';
import { canvasToRaster } from './renderer';

export interface QrLabelOptions {
	/** URL or text to encode in QR */
	url: string;
	/** Primary text (e.g., "Ckt 7 · Main Panel") */
	line1: string;
	/** Secondary text (e.g., "Kitchen Counter") */
	line2: string;
	/** Tertiary text (e.g., "20A GFCI") */
	line3?: string;
	/** Label width in mm */
	widthMm?: number;
	/** Label height in mm */
	heightMm?: number;
	/** DPI (default 203 for Phomemo) */
	dpi?: number;
}

/**
 * Render a QR combo label.
 * Default size: 15×50mm (comfortable QR + text on continuous tape)
 * Also works at 12×40mm (tighter, smaller QR)
 */
export async function renderQrLabel(options: QrLabelOptions): Promise<RenderedLabel> {
	const {
		url,
		line1,
		line2,
		line3,
		widthMm = 50,
		heightMm = 15,
		dpi = 203,
	} = options;

	const widthPx = mmToPx(widthMm, dpi);
	const heightPx = mmToPx(heightMm, dpi);

	const canvas = document.createElement('canvas');
	canvas.width = widthPx;
	canvas.height = heightPx;
	const ctx = canvas.getContext('2d')!;

	// White background
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, widthPx, heightPx);

	// Generate QR code as data URL
	const qrSize = heightPx - 8; // Leave 4px margin top/bottom
	const qrDataUrl = await QRCode.toDataURL(url, {
		width: qrSize,
		margin: 1,
		errorCorrectionLevel: 'M',
		color: { dark: '#000000', light: '#ffffff' },
	});

	// Draw QR code on left side
	const qrImg = await loadImage(qrDataUrl);
	const qrX = 4;
	const qrY = (heightPx - qrSize) / 2;
	ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

	// Draw text to the right of QR
	const textX = qrX + qrSize + 6;
	const textWidth = widthPx - textX - 4;

	ctx.fillStyle = '#000000';
	ctx.textAlign = 'left';

	// Scale font based on available height
	const lineCount = line3 ? 3 : 2;
	const maxFontSize = Math.min(12, Math.floor((heightPx - 8) / lineCount) - 2);
	const primarySize = Math.max(8, maxFontSize);
	const secondarySize = Math.max(7, primarySize - 2);

	// Line 1 (bold)
	ctx.font = `bold ${primarySize}px "SF Mono", "Cascadia Code", "Courier New", monospace`;
	const y1 = line3
		? Math.round(heightPx * 0.28)
		: Math.round(heightPx * 0.38);
	ctx.fillText(truncateText(ctx, line1, textWidth), textX, y1);

	// Line 2
	ctx.font = `${secondarySize}px "SF Mono", "Courier New", monospace`;
	const y2 = line3
		? Math.round(heightPx * 0.55)
		: Math.round(heightPx * 0.68);
	ctx.fillText(truncateText(ctx, line2, textWidth), textX, y2);

	// Line 3 (optional)
	if (line3) {
		ctx.font = `${secondarySize}px "SF Mono", "Courier New", monospace`;
		const y3 = Math.round(heightPx * 0.82);
		ctx.fillText(truncateText(ctx, line3, textWidth), textX, y3);
	}

	const { raster, bytesPerLine } = canvasToRaster(canvas);

	return {
		canvas,
		width: widthPx,
		height: heightPx,
		widthMm,
		heightMm,
		rasterData: raster,
		bytesPerLine,
	};
}

/** Build the app URL for a circuit */
export function buildCircuitUrl(baseUrl: string, panelId: number, circuitId: number): string {
	return `${baseUrl}/panels?panel=${panelId}&circuit=${circuitId}`;
}

/** Build the app URL for a device */
export function buildDeviceUrl(baseUrl: string, deviceId: number): string {
	return `${baseUrl}/rooms?device=${deviceId}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = reject;
		img.src = src;
	});
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let truncated = text;
	while (truncated.length > 0 && ctx.measureText(truncated + '…').width > maxWidth) {
		truncated = truncated.slice(0, -1);
	}
	return truncated + '…';
}
