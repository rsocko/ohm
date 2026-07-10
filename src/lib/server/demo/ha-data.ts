/**
 * Demo Home Assistant data — simulated entity states and energy readings.
 */

import type { HAEntityState, HAApiInfo } from '../ha-transport';

export const DEMO_HA_API_INFO: HAApiInfo = {
	message: 'API running.',
	version: '2025.7.1',
	location_name: 'Willow House',
	installation_type: 'Home Assistant OS'
};

function randomWatts(base: number, variance: number): string {
	return (base + (Math.random() - 0.5) * variance).toFixed(1);
}

const now = new Date().toISOString();

export function getDemoHAStates(): HAEntityState[] {
	return [
		// Emporia Vue power sensors
		{
			entity_id: 'sensor.emporia_vue_living_room_plugs',
			state: randomWatts(85, 40),
			attributes: { friendly_name: 'Living Room Plugs', device_class: 'power', unit_of_measurement: 'W' },
			last_changed: now,
			last_updated: now
		},
		{
			entity_id: 'sensor.emporia_vue_counter_plugs',
			state: randomWatts(120, 60),
			attributes: { friendly_name: 'Counter Plugs', device_class: 'power', unit_of_measurement: 'W' },
			last_changed: now,
			last_updated: now
		},
		{
			entity_id: 'sensor.emporia_vue_living_room_lights',
			state: randomWatts(45, 20),
			attributes: { friendly_name: 'Living Room Lights', device_class: 'power', unit_of_measurement: 'W' },
			last_changed: now,
			last_updated: now
		},
		{
			entity_id: 'sensor.emporia_vue_kitchen_recessed',
			state: randomWatts(72, 15),
			attributes: { friendly_name: 'Kitchen Recessed Lights', device_class: 'power', unit_of_measurement: 'W' },
			last_changed: now,
			last_updated: now
		},
		{
			entity_id: 'sensor.emporia_vue_air_conditioner',
			state: randomWatts(1800, 400),
			attributes: { friendly_name: 'Air Conditioner', device_class: 'power', unit_of_measurement: 'W' },
			last_changed: now,
			last_updated: now
		},
		{
			entity_id: 'sensor.emporia_vue_ev_charger',
			state: randomWatts(7200, 200),
			attributes: { friendly_name: 'EV Charger', device_class: 'power', unit_of_measurement: 'W' },
			last_changed: now,
			last_updated: now
		},
		{
			entity_id: 'sensor.emporia_vue_washer',
			state: randomWatts(450, 100),
			attributes: { friendly_name: 'Washer', device_class: 'power', unit_of_measurement: 'W' },
			last_changed: now,
			last_updated: now
		},
		{
			entity_id: 'sensor.emporia_vue_dryer',
			state: randomWatts(3500, 500),
			attributes: { friendly_name: 'Dryer', device_class: 'power', unit_of_measurement: 'W' },
			last_changed: now,
			last_updated: now
		},
		{
			entity_id: 'sensor.emporia_vue_master_bedroom',
			state: randomWatts(35, 15),
			attributes: { friendly_name: 'Master Bedroom', device_class: 'power', unit_of_measurement: 'W' },
			last_changed: now,
			last_updated: now
		},
		{
			entity_id: 'sensor.emporia_vue_total_usage',
			state: randomWatts(4200, 800),
			attributes: { friendly_name: 'Total Usage', device_class: 'power', unit_of_measurement: 'W' },
			last_changed: now,
			last_updated: now
		},
		// Solar (Enphase)
		{
			entity_id: 'sensor.enphase_current_power_production',
			state: randomWatts(3800, 1000),
			attributes: { friendly_name: 'Solar Production', device_class: 'power', unit_of_measurement: 'W' },
			last_changed: now,
			last_updated: now
		},
		{
			entity_id: 'sensor.enphase_today_s_energy_production',
			state: '18.4',
			attributes: { friendly_name: "Today's Solar Energy", device_class: 'energy', unit_of_measurement: 'kWh' },
			last_changed: now,
			last_updated: now
		},
		// General sensors
		{
			entity_id: 'sensor.indoor_temperature',
			state: '72.1',
			attributes: { friendly_name: 'Indoor Temperature', device_class: 'temperature', unit_of_measurement: '°F' },
			last_changed: now,
			last_updated: now
		},
		{
			entity_id: 'switch.family_room_lights',
			state: 'on',
			attributes: { friendly_name: 'Family Room Lights' },
			last_changed: now,
			last_updated: now
		},
		{
			entity_id: 'switch.kitchen_island_lights',
			state: 'on',
			attributes: { friendly_name: 'Kitchen Island Lights' },
			last_changed: now,
			last_updated: now
		}
	];
}

export function getDemoEntityState(entityId: string): HAEntityState | null {
	const states = getDemoHAStates();
	return states.find((s) => s.entity_id === entityId) || null;
}

/**
 * Generate fake history data for an entity (last 24h in hourly intervals).
 */
export function getDemoHistory(entityId: string): HAEntityState[][] {
	const baseState = getDemoEntityState(entityId);
	if (!baseState) return [[]];

	const baseWatts = parseFloat(baseState.state) || 100;
	const history: HAEntityState[] = [];
	const now = Date.now();

	for (let i = 24; i >= 0; i--) {
		const timestamp = new Date(now - i * 3600_000).toISOString();
		// Simulate daily curve (higher usage midday for solar, evening for consumption)
		const hourOfDay = new Date(now - i * 3600_000).getHours();
		const multiplier = entityId.includes('solar') || entityId.includes('enphase')
			? Math.max(0, Math.sin((hourOfDay - 6) * Math.PI / 12)) // Solar curve
			: 0.5 + 0.5 * Math.sin((hourOfDay - 8) * Math.PI / 16); // Usage curve

		history.push({
			entity_id: entityId,
			state: (baseWatts * multiplier * (0.8 + Math.random() * 0.4)).toFixed(1),
			attributes: baseState.attributes,
			last_changed: timestamp,
			last_updated: timestamp
		});
	}

	return [history];
}
