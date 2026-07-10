/**
 * Demo UniFi data — simulated network devices and clients.
 */

import type { UnifiDevice, UnifiClient } from '../unifi';

export function getDemoUnifiDevices(): UnifiDevice[] {
	return [
		{
			mac: 'f0:9f:c2:aa:11:01',
			ip: '192.0.2.1',
			name: 'UDM Pro',
			model: 'UDM-Pro',
			model_in_lts: true,
			type: 'udm',
			adopted: true,
			state: 1,
			version: '4.0.6',
			system_stats: { cpu: '12', mem: '54', uptime: '2592000' }
		},
		{
			mac: 'f0:9f:c2:bb:22:02',
			ip: '192.0.2.1',
			name: 'USW-24-PoE',
			model: 'USW-24-PoE',
			model_in_lts: true,
			type: 'usw',
			adopted: true,
			state: 1,
			version: '7.1.26',
			port_table: [
				{ port_idx: 1, name: 'Port 1', media: 'GE', speed: 1000, up: true, poe_enable: true, poe_power: '6.2', poe_voltage: '53.4', poe_current: '0.116', poe_class: 'Class 3' },
				{ port_idx: 2, name: 'Port 2', media: 'GE', speed: 1000, up: true, poe_enable: true, poe_power: '4.1', poe_voltage: '53.2', poe_current: '0.077', poe_class: 'Class 2' },
				{ port_idx: 3, name: 'Port 3', media: 'GE', speed: 1000, up: true },
				{ port_idx: 4, name: 'Port 4', media: 'GE', speed: 100, up: true, poe_enable: true, poe_power: '3.8', poe_voltage: '53.1', poe_current: '0.072', poe_class: 'Class 2' }
			],
			system_stats: { cpu: '8', mem: '32', uptime: '2592000' }
		},
		{
			mac: 'f0:9f:c2:cc:33:03',
			ip: '192.0.2.1',
			name: 'U6-LR (Living Room)',
			model: 'U6-LR',
			model_in_lts: true,
			type: 'uap',
			adopted: true,
			state: 1,
			version: '7.1.26',
			uplink: { mac: 'f0:9f:c2:bb:22:02', type: 'wire', uplink_mac: 'f0:9f:c2:bb:22:02', uplink_remote_port: 1 },
			system_stats: { cpu: '15', mem: '45', uptime: '2592000' }
		},
		{
			mac: 'f0:9f:c2:dd:44:04',
			ip: '192.0.2.1',
			name: 'U6-Lite (Kitchen)',
			model: 'U6-Lite',
			model_in_lts: true,
			type: 'uap',
			adopted: true,
			state: 1,
			version: '7.1.26',
			uplink: { mac: 'f0:9f:c2:bb:22:02', type: 'wire', uplink_mac: 'f0:9f:c2:bb:22:02', uplink_remote_port: 2 },
			system_stats: { cpu: '10', mem: '38', uptime: '2592000' }
		}
	];
}

export function getDemoUnifiClients(): UnifiClient[] {
	return [
		{ mac: 'aa:bb:cc:11:22:33', ip: '192.0.2.101', hostname: 'MacBook-Pro', name: 'MacBook Pro', oui: 'Apple', is_wired: true, is_guest: false, uptime: 86400, last_seen: Date.now() / 1000 },
		{ mac: 'aa:bb:cc:44:55:66', ip: '192.0.2.102', hostname: 'iphone-14', name: 'iPhone 14', oui: 'Apple', is_wired: false, is_guest: false, uptime: 43200, last_seen: Date.now() / 1000 },
		{ mac: 'dd:ee:ff:11:22:33', ip: '192.0.2.110', hostname: 'ring-doorbell', name: 'Ring Doorbell', oui: 'Amazon', is_wired: true, is_guest: false, uptime: 604800, last_seen: Date.now() / 1000 },
		{ mac: 'dd:ee:ff:44:55:66', ip: '192.0.2.111', hostname: 'nest-thermostat', name: 'Nest Thermostat', oui: 'Google', is_wired: true, is_guest: false, uptime: 604800, last_seen: Date.now() / 1000 },
		{ mac: 'dd:ee:ff:77:88:99', ip: '192.0.2.112', hostname: 'emporia-vue', name: 'Emporia Vue Monitor', oui: 'Emporia', is_wired: true, is_guest: false, uptime: 604800, last_seen: Date.now() / 1000 },
		{ mac: 'dd:ee:ff:aa:bb:cc', ip: '192.0.2.113', hostname: 'enphase-envoy', name: 'Enphase Envoy', oui: 'Enphase', is_wired: true, is_guest: false, uptime: 604800, last_seen: Date.now() / 1000 },
		{ mac: 'aa:bb:cc:77:88:99', ip: '192.0.2.103', hostname: 'samsung-tv', name: 'Living Room TV', oui: 'Samsung', is_wired: true, is_guest: false, uptime: 172800, last_seen: Date.now() / 1000 }
	];
}

export const DEMO_UNIFI_SITES = [
	{ name: 'default', desc: 'Willow House' }
];
