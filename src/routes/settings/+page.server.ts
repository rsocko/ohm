import type { PageServerLoad } from './$types';
import { getAiConfig } from '$lib/server/ai-config';
import { getPrinterConfig } from '$lib/server/printer-config';

// Fetch global configs in parallel (AI and Printer are not per-home)
export const load: PageServerLoad = async () => {
	const [config, printerConfig] = await Promise.all([
		getAiConfig().catch(() => ({ enabled: false, openWebUiUrl: '', openWebUiApiKey: '', openWebUiModel: '', askApiKey: '', askAuthRequired: false, updatedAt: null })),
		getPrinterConfig().catch(() => ({ tapeWidthMm: 15, labelLengthMm: null, defaultCircuitFormat: 'compact' as const, density: 'normal', dpi: 203, serviceUuid: '', writeCharUuid: '', chunkSize: 100, chunkDelayMs: 20, updatedAt: null }))
	]);
	return { config, printerConfig };
};
