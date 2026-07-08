/**
 * Shared device type configurations, options, and constants.
 * Used by: Rooms page, Devices page, LoadEditForm component.
 */

/** NocoDB v3 record shape (shared across client components) */
export interface V3Record {
	id: number;
	fields: Record<string, unknown>;
}

export interface DeviceTypeConfig {
	label: string;
	color: string;
	icon: string;
	markerBg: string;
}

export const receptacleTypeConfig: Record<string, DeviceTypeConfig> = {
	'Outlet': { label: 'Outlet', color: 'bg-blue-500/20 text-blue-400', icon: 'mdi:power-socket-us', markerBg: 'bg-blue-500/80' },
	'GFCI Outlet': { label: 'GFCI', color: 'bg-emerald-500/20 text-emerald-400', icon: 'mdi:shield-check', markerBg: 'bg-emerald-500/80' },
	'Smart Switch': { label: 'Smart Switch', color: 'bg-violet-500/20 text-violet-400', icon: 'mdi:home-automation', markerBg: 'bg-violet-500/80' },
	'Dimmer Switch': { label: 'Dimmer', color: 'bg-indigo-500/20 text-indigo-400', icon: 'mdi:brightness-6', markerBg: 'bg-indigo-500/80' },
	'On/Off Switch': { label: 'Switch', color: 'bg-slate-500/20 text-slate-300', icon: 'mdi:toggle-switch', markerBg: 'bg-slate-500/80' },
	'On/Off Relay': { label: 'Relay', color: 'bg-cyan-500/20 text-cyan-400', icon: 'mdi:electric-switch', markerBg: 'bg-cyan-500/80' },
	'Timer Switch': { label: 'Timer', color: 'bg-teal-500/20 text-teal-400', icon: 'mdi:timer', markerBg: 'bg-teal-500/80' },
	'Networking': { label: 'Network', color: 'bg-indigo-500/20 text-indigo-400', icon: 'mdi:ethernet', markerBg: 'bg-indigo-500/80' },
	'Coax': { label: 'Coax', color: 'bg-sky-500/20 text-sky-400', icon: 'mdi:cable-data', markerBg: 'bg-sky-500/80' },
	'Other': { label: 'Other', color: 'bg-slate-600/30 text-slate-500', icon: 'mdi:help-circle-outline', markerBg: 'bg-slate-600/80' },
};

export const loadTypeConfig: Record<string, DeviceTypeConfig> = {
	'Light - Ceiling': { label: 'Ceiling Light', color: 'bg-amber-500/20 text-amber-300', icon: 'mdi:ceiling-light', markerBg: 'bg-amber-500/80' },
	'Light - Wall Mounted': { label: 'Wall Light', color: 'bg-amber-500/20 text-amber-300', icon: 'mdi:wall-sconce', markerBg: 'bg-amber-500/80' },
	'Light - Recessed': { label: 'Recessed', color: 'bg-amber-500/20 text-amber-300', icon: 'mdi:lightbulb-spot', markerBg: 'bg-amber-500/80' },
	'Light - Under Cabinet': { label: 'Under Cabinet', color: 'bg-amber-500/20 text-amber-300', icon: 'mdi:led-strip-variant', markerBg: 'bg-amber-500/80' },
	'Light - Landscape': { label: 'Landscape', color: 'bg-amber-500/20 text-amber-300', icon: 'mdi:outdoor-lamp', markerBg: 'bg-amber-500/80' },
	'Lamp/Other Light': { label: 'Lamp', color: 'bg-amber-500/20 text-amber-300', icon: 'mdi:lamp', markerBg: 'bg-amber-500/80' },
	'Ceiling Fan/Light': { label: 'Fan/Light', color: 'bg-amber-500/20 text-amber-300', icon: 'mdi:ceiling-fan-light', markerBg: 'bg-amber-500/80' },
	'Vent Fan': { label: 'Vent Fan', color: 'bg-yellow-500/20 text-yellow-300', icon: 'mdi:fan', markerBg: 'bg-yellow-500/80' },
	'Electronics': { label: 'Electronics', color: 'bg-rose-500/20 text-rose-300', icon: 'mdi:monitor', markerBg: 'bg-rose-500/80' },
	'TV': { label: 'TV', color: 'bg-rose-500/20 text-rose-300', icon: 'mdi:television', markerBg: 'bg-rose-500/80' },
	'Computer': { label: 'Computer', color: 'bg-rose-500/20 text-rose-300', icon: 'mdi:desktop-tower-monitor', markerBg: 'bg-rose-500/80' },
	'Speaker': { label: 'Speaker', color: 'bg-rose-500/20 text-rose-300', icon: 'mdi:speaker', markerBg: 'bg-rose-500/80' },
	'Gaming Console': { label: 'Gaming', color: 'bg-rose-500/20 text-rose-300', icon: 'mdi:controller', markerBg: 'bg-rose-500/80' },
	'Camera': { label: 'Camera', color: 'bg-pink-500/20 text-pink-300', icon: 'mdi:cctv', markerBg: 'bg-pink-500/80' },
	'Camera/Light Combo': { label: 'Cam+Light', color: 'bg-pink-500/20 text-pink-300', icon: 'lucide:spotlight', markerBg: 'bg-pink-500/80' },
	'Doorbell': { label: 'Doorbell', color: 'bg-pink-500/20 text-pink-300', icon: 'mdi:doorbell-video', markerBg: 'bg-pink-500/80' },
	'Smoke/CO Detector': { label: 'Smoke/CO', color: 'bg-pink-500/20 text-pink-300', icon: 'mdi:smoke-detector-variant', markerBg: 'bg-pink-500/80' },
	'Appliance': { label: 'Appliance', color: 'bg-orange-500/20 text-orange-300', icon: 'mdi:dishwasher', markerBg: 'bg-orange-500/80' },
	'Refrigerator': { label: 'Fridge', color: 'bg-orange-500/20 text-orange-300', icon: 'mdi:fridge-outline', markerBg: 'bg-orange-500/80' },
	'Washer/Dryer': { label: 'Washer/Dryer', color: 'bg-orange-500/20 text-orange-300', icon: 'mdi:washing-machine', markerBg: 'bg-orange-500/80' },
	'Oven/Range': { label: 'Oven/Range', color: 'bg-orange-500/20 text-orange-300', icon: 'mdi:stove', markerBg: 'bg-orange-500/80' },
	'Microwave': { label: 'Microwave', color: 'bg-orange-500/20 text-orange-300', icon: 'mdi:microwave', markerBg: 'bg-orange-500/80' },
	'Disposal': { label: 'Disposal', color: 'bg-orange-500/20 text-orange-300', icon: 'mdi:cog', markerBg: 'bg-orange-500/80' },
	'HVAC': { label: 'HVAC', color: 'bg-red-500/20 text-red-300', icon: 'mdi:hvac', markerBg: 'bg-red-500/80' },
	'Water Heater': { label: 'Water Heater', color: 'bg-red-500/20 text-red-300', icon: 'mdi:water-boiler', markerBg: 'bg-red-500/80' },
	'Pump': { label: 'Pump', color: 'bg-red-500/20 text-red-300', icon: 'mdi:pump', markerBg: 'bg-red-500/80' },
	'Motor': { label: 'Motor', color: 'bg-red-500/20 text-red-300', icon: 'mdi:engine', markerBg: 'bg-red-500/80' },
	'Garage Door': { label: 'Garage Door', color: 'bg-red-500/20 text-red-300', icon: 'mdi:garage-variant', markerBg: 'bg-red-500/80' },
	'EV Charger': { label: 'EV Charger', color: 'bg-red-500/20 text-red-300', icon: 'mdi:ev-station', markerBg: 'bg-red-500/80' },
	'Irrigation': { label: 'Irrigation', color: 'bg-orange-400/20 text-orange-300', icon: 'mdi:sprinkler-variant', markerBg: 'bg-orange-400/80' },
	'Networking': { label: 'Network', color: 'bg-fuchsia-500/20 text-fuchsia-300', icon: 'mdi:router-wireless', markerBg: 'bg-fuchsia-500/80' },
};

export const networkRoleOptions = [
	'Switch',
	'Access Point',
	'Camera',
	'Gateway',
	'Bridge',
	'Client Device',
	'Patch Panel'
] as const;

export const powerSourceOptions = ['Circuit', 'POE', 'Battery', 'Low Voltage DC'] as const;

export type NetworkRole = (typeof networkRoleOptions)[number];
export type PowerSource = (typeof powerSourceOptions)[number];
