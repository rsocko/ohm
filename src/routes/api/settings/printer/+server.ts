import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPrinterConfig, savePrinterConfig } from '$lib/server/printer-config';

export const GET: RequestHandler = async () => {
	const config = await getPrinterConfig();
	return json(config);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		deviceName?: string | null;
		tapeWidthMm?: number;
		labelLengthMm?: number | string;
		dpi?: number;
		density?: number;
		serviceUuid?: string;
		writeCharUuid?: string;
		chunkSize?: number;
		chunkDelayMs?: number;
		defaultCircuitFormat?: 'compact' | 'detailed';
	};

	const config = await savePrinterConfig({
		deviceName: body.deviceName,
		tapeWidthMm: body.tapeWidthMm as any,
		labelLengthMm: body.labelLengthMm as any,
		dpi: body.dpi,
		density: body.density,
		serviceUuid: body.serviceUuid,
		writeCharUuid: body.writeCharUuid,
		chunkSize: body.chunkSize,
		chunkDelayMs: body.chunkDelayMs,
		defaultCircuitFormat: body.defaultCircuitFormat
	});

	return json(config);
};
