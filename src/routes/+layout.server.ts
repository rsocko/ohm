import { getAiConfig } from '$lib/server/ai-config';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	try {
		const config = await getAiConfig();
		return { aiEnabled: config.enabled };
	} catch {
		return { aiEnabled: false };
	}
};
