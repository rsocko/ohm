/** Shared types for the unified device layer. */

export type DeviceSource = 'nocodb' | 'unifi' | 'ha' | 'homebox';

export interface UnifiedDevice {
	id: string;
	name: string;
	icon?: string;
	deviceCategory: string;
	circuitId?: string;
	circuitName?: string;
	panelName?: string;
	breakerAmps?: number;
	areaId?: number;
	areaName?: string;
	powerSource?: string;
	network?: {
		mac: string;
		ip: string;
		hostname: string;
		isOnline: boolean;
		lastSeen: number;
		switchPort?: { switchName: string; port: number };
		poePower?: number;
		manufacturer?: string;
		vlan?: string;
		uptime?: number;
	};
	homeAssistant?: {
		deviceId: string;
		manufacturer: string | null;
		model: string | null;
		swVersion: string | null;
		areaName: string | null;
		entityCount: number;
		isControllable: boolean;
		viaDevice?: string | null;
		entities?: string[];
	};
	inventory?: {
		itemId: string;
		serialNumber?: string;
		purchaseDate?: string;
		warrantyExpiry?: string;
		value?: number;
		photoUrl?: string;
		notes?: string;
	};
	sources: DeviceSource[];
}
