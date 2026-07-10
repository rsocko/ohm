/**
 * Demo mode central module.
 * When DEMO_MODE=true, the app serves realistic fixture data
 * without requiring NocoDB, Home Assistant, or UniFi connections.
 */

import { env } from '$env/dynamic/private';

let _isDemoMode: boolean | null = null;

export function isDemoMode(): boolean {
	if (_isDemoMode === null) {
		_isDemoMode = env.DEMO_MODE === 'true' || env.DEMO_MODE === '1';
	}
	return _isDemoMode;
}
