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
	// QR takes full tape height minus margins for maximum scannability
	const qrMargin = 4;
	const qrSize = heightPx - qrMargin * 2;
	const qrDataUrl = await QRCode.toDataURL(url, {
		width: qrSize,
		margin: 1,
		errorCorrectionLevel: 'M',
		color: { dark: '#000000', light: '#ffffff' },
	});

	// Draw QR code on left side, with D30 vertical offset
	const verticalOffset = Math.round(heightPx * 0.06); // Match circuit label D30 bias
	const qrImg = await loadImage(qrDataUrl);
	const qrX = 4;
	const qrY = (heightPx - qrSize) / 2 + verticalOffset;
	ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

	// Draw text to the right of QR — use readable font sizes
	const textX = qrX + qrSize + 8;
	const textWidth = widthPx - textX - 4;

	ctx.fillStyle = '#000000';
	ctx.textAlign = 'left';

	// Scale fonts — line1 (name) is primary, should be large and readable
	// For 96px (12mm tape): primary ~26px, secondary ~18px
	const lineCount = line3 ? 3 : 2;
	const primarySize = Math.max(16, Math.round(heightPx * 0.26));
	const secondarySize = Math.max(12, Math.round(heightPx * 0.18));

	// Vertically center the text block with D30 offset
	const totalTextHeight = primarySize + (lineCount - 1) * secondarySize + (lineCount - 1) * 4;
	const textStartY = (heightPx - totalTextHeight) / 2 + primarySize + verticalOffset;

	// Line 1 (bold)
	ctx.font = `bold ${primarySize}px sans-serif`;
	ctx.fillText(truncateText(ctx, line1, textWidth), textX, textStartY);

	// Line 2
	ctx.font = `${secondarySize}px sans-serif`;
	const y2 = textStartY + secondarySize + 4;
	ctx.fillText(truncateText(ctx, line2, textWidth), textX, y2);

	// Line 3 (optional)
	if (line3) {
		ctx.font = `${secondarySize}px sans-serif`;
		const y3 = y2 + secondarySize + 4;
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
