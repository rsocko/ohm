/**
 * Grid positioning service for AR panel overlay.
 * Computes breaker cell positions based on panel slot data and calibration offsets.
 */

interface V3Record {
	id: number;
	fields: Record<string, unknown>;
}

export interface GridCalibration {
	topPct: number;
	bottomPct: number;
	leftPct: number;
	rightPct: number;
}

export interface SlotPosition {
	circuit: V3Record;
	side: 'left' | 'right';
	row: number;
	poles: number;
	top: string;
	height: string;
	left: string;
	width: string;
}

export interface UtilizationResult {
	percent: number;
	status: 'normal' | 'high' | 'overloaded' | 'unknown';
}

const DEFAULT_CALIBRATION: GridCalibration = {
	topPct: 8,
	bottomPct: 92,
	leftPct: 10,
	rightPct: 90
};

/**
 * Infer the number of poles from circuit data.
 */
export function inferPoles(circuit: V3Record): number {
	const slot = (circuit.fields['Panel Slot'] as string) || '';
	if (slot.includes(',')) return 2;
	const amps = (circuit.fields.Amps as number) || 0;
	if (amps >= 30) return 2;
	return 1;
}

/**
 * Detect if a circuit is a tandem (half-height) breaker.
 */
export function isTandem(circuit: V3Record): boolean {
	const slot = (circuit.fields['Panel Slot'] as string) || '';
	return slot.includes('.');
}

/**
 * Parse tandem slot info: "21.1" → { baseSlot: 21, position: 1 }
 */
export function parseTandemSlot(circuit: V3Record): { baseSlot: number; position: number } | null {
	const slot = (circuit.fields['Panel Slot'] as string) || '';
	const match = slot.match(/^(\d+)\.(\d+)$/);
	if (match) return { baseSlot: parseInt(match[1]), position: parseInt(match[2]) };
	return null;
}

/**
 * Compute positioned grid slots for all circuits in a panel.
 */
export function computeSlotPositions(
	circuits: V3Record[],
	capacity: number,
	calibration: GridCalibration = DEFAULT_CALIBRATION
): SlotPosition[] {
	const { topPct, bottomPct, leftPct, rightPct } = calibration;

	// Calculate max row used
	let maxRow = 0;
	for (const circuit of circuits) {
		const num = circuit.fields.Number as number;
		const poles = inferPoles(circuit);
		const row = Math.ceil(num / 2);
		maxRow = Math.max(maxRow, row + (poles === 2 ? 1 : 0));
	}
	const slotsPerSide = maxRow || Math.ceil(capacity / 2);

	const gridHeight = bottomPct - topPct;
	const gridWidth = rightPct - leftPct;
	const slotHeight = gridHeight / slotsPerSide;
	const midpoint = leftPct + gridWidth / 2;
	const sideWidth = gridWidth / 2 - 1;
	const gap = 0.5;

	return circuits.map((circuit): SlotPosition => {
		const num = circuit.fields.Number as number;
		const poles = inferPoles(circuit);
		const tandem = parseTandemSlot(circuit);
		const side = num % 2 === 1 ? 'left' : 'right';
		const slotIndex = Math.ceil(num / 2) - 1;

		const height = tandem ? slotHeight * 0.5 : slotHeight * poles;
		const topOffset = tandem && tandem.position === 2 ? slotHeight * 0.5 : 0;

		return {
			circuit,
			side: side as 'left' | 'right',
			row: slotIndex,
			poles: tandem ? 0.5 : poles,
			top: `${topPct + slotIndex * slotHeight + topOffset + gap}%`,
			height: `${height - gap * 2}%`,
			left: side === 'left' ? `${leftPct}%` : `${midpoint + 1}%`,
			width: `${sideWidth}%`
		};
	});
}

/**
 * Calculate circuit utilization based on connected loads.
 */
export function computeUtilization(
	circuit: V3Record,
	loadsByCircuitId: Map<number, V3Record[]>
): UtilizationResult {
	const amps = circuit.fields.Amps as number | undefined;
	if (!amps) return { percent: 0, status: 'unknown' };

	const circuitLoads = loadsByCircuitId.get(circuit.id) || [];
	let totalWatts = 0;
	for (const load of circuitLoads) {
		const watts = load.fields.Wattage as number | undefined;
		if (watts) totalWatts += watts;
	}

	if (totalWatts === 0) return { percent: 0, status: 'unknown' };

	// NEC 80% continuous load derating
	const voltage = (circuit.fields.Voltage as string)?.includes('240') ? 240 : 120;
	const maxWatts = amps * voltage * 0.8;
	const percent = Math.round((totalWatts / maxWatts) * 100);

	if (percent > 80) return { percent, status: 'overloaded' };
	if (percent > 60) return { percent, status: 'high' };
	return { percent, status: 'normal' };
}

/**
 * Load saved calibration from localStorage.
 */
export function loadCalibration(panelId: number): GridCalibration | null {
	try {
		const key = `ar-calibration-panel-${panelId}`;
		const stored = localStorage.getItem(key);
		if (stored) return JSON.parse(stored) as GridCalibration;
	} catch {
		// Ignore parse errors
	}
	return null;
}

/**
 * Save calibration to localStorage.
 */
export function saveCalibration(panelId: number, calibration: GridCalibration): void {
	try {
		const key = `ar-calibration-panel-${panelId}`;
		localStorage.setItem(key, JSON.stringify(calibration));
	} catch {
		// Ignore storage errors
	}
}
