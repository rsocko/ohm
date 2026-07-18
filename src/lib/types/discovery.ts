/** Shared types for the device discovery system. */

export interface DiscoveryItem {
	id: string;
	source: 'unifi' | 'ha' | 'homebox';
	externalId: string;
	name: string;
	type: string;
	ip?: string;
	manufacturer?: string;
	model?: string;
	isOnline?: boolean;
	powerSource?: string;
	inferredCategory?: string;
	inferredAreaId?: number;
	inferredAreaName?: string;
	status: 'suggested' | 'unmatched' | 'ignored';
	suggestion?: {
		loadId: number;
		loadName: string;
		confidence: number;
		reason: string;
	};
	metadata: Record<string, unknown>;
}

export interface DiscoveryResponse {
	items: DiscoveryItem[];
	availableLoads: Array<{ id: number; title: string; areaName?: string }>;
	areas: Array<{ id: number; name: string }>;
	summary: { suggested: number; unmatched: number; ignored: number; total: number };
	sources: { unifi: boolean; ha: boolean };
}
