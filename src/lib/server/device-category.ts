/**
 * Shared device category inference.
 *
 * Consolidates category heuristics used by both the unified endpoint
 * and the discovery endpoint into a single source of truth.
 */

import { loadTypeConfig } from '$lib/config/device-types';

export type DeviceCategory =
	| 'networking'
	| 'camera'
	| 'media'
	| 'computing'
	| 'iot-hub'
	| 'climate'
	| 'lighting'
	| 'sensor'
	| 'appliance'
	| 'power'
	| 'security'
	| 'other';

/**
 * Infer device category from NocoDB load fields.
 * Uses Device Type and Network_Role first, then falls back to name heuristics.
 */
export function inferDeviceCategory(fields: Record<string, unknown>): DeviceCategory {
	const type = String(fields['Device Type'] || '').toLowerCase();
	const role = String(fields.Network_Role || '').toLowerCase();
	const name = String(fields.Title || fields.Name || fields.name || '').toLowerCase();

	return inferFromTypeRoleName(type, role, name);
}

/**
 * Infer category from Home Assistant device metadata.
 */
export function inferCategoryFromHA(device: {
	manufacturer: string | null;
	model: string | null;
	name: string | null;
}): DeviceCategory {
	const name = (device.name || '').toLowerCase();
	const mfr = (device.manufacturer || '').toLowerCase();
	const model = (device.model || '').toLowerCase();

	return inferFromCombinedText(`${name} ${mfr} ${model}`);
}

/**
 * Resolve the display icon: use custom override, fall back to type-based default.
 */
export function resolveDeviceIcon(fields: Record<string, unknown>): string | undefined {
	const iconField = String(fields.Icon || '').trim();
	if (iconField && iconField.toLowerCase() !== 'default' && iconField.includes(':')) {
		return iconField;
	}
	const deviceType = String(fields['Device Type'] || '');
	const typeConfig = loadTypeConfig[deviceType];
	if (typeConfig) return typeConfig.icon;
	return undefined;
}

// --- Internal helpers ---

function inferFromTypeRoleName(type: string, role: string, name: string): DeviceCategory {
	// Type-based checks first (most reliable)
	if (type === 'networking' || role === 'router' || role === 'switch' || role === 'ap' || role === 'access point') return 'networking';
	if (type === 'camera') return 'camera';
	if (type === 'electronics') return 'media';
	if (type.includes('light') || type.includes('lamp') || type === 'ceiling fan/light') return 'lighting';
	if (type === 'hvac' || type === 'vent fan') return 'climate';
	if (type === 'appliance' || type === 'washer/dryer' || type.includes('washer') || type.includes('dryer')) return 'appliance';
	if (type === 'ev charger') return 'power';
	if (type === 'smoke/co detector' || type === 'doorbell') return 'security';

	// Name-based heuristics (fallback)
	return inferFromCombinedText(name);
}

function inferFromCombinedText(text: string): DeviceCategory {
	if (/router|switch|ap|unifi|network/.test(text) && !/light\s?switch/.test(text)) return 'networking';
	if (/camera|doorbell|protect/.test(text)) return 'camera';
	if (/projector|speaker|sonos|receiver|\btv\b|chromecast|roku/.test(text)) return 'media';
	if (/raspberry|server|nas|desktop|pc|computer/.test(text)) return 'computing';
	if (/hub|bridge|coordinator|zigbee|zwave|yolink|smartthings/.test(text)) return 'iot-hub';
	if (/thermostat|ecobee|nest|hvac|furnace|air conditioner|dehumidifier|humidifier|fan|exhaust/.test(text)) return 'climate';
	if (/light|lamp|bulb|sconce|chandelier|hue|wled|led/.test(text)) return 'lighting';
	if (/sensor|motion|door|window|leak|temp/.test(text)) return 'sensor';
	if (/washer|dryer|fridge|refrigerator|dishwasher|oven|microwave|garbage disposal|range|stove|freezer/.test(text)) return 'appliance';
	if (/ups|pdu|plug|outlet|relay|ev charger|charger|emporia/.test(text)) return 'power';
	if (/lock|alarm|siren|smoke|shield/.test(text)) return 'security';
	return 'other';
}
