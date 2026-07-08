/**
 * Energy integration TypeScript types.
 * Covers Emporia Vue readings, Enphase solar, entity mappings, and API contracts.
 */

// --- Time Ranges ---

export type TimeRange = 'live' | '1h' | '24h' | '7d' | '30d';

// --- Entity Mapping ---

export interface EntityMapping {
	circuitId: number;
	circuitName: string;
	panelName: string;
	entityId: string; // primary entity (power preferred, falls back to energy)
	powerEntityId: string | null;
	energyEntityId: string | null;
	ampRating: number;
	voltage: number; // 120 or 240
}

// --- Live Readings ---

export type TrendDirection = 'up' | 'down' | 'flat';

export interface CircuitReading {
	circuitId: number;
	circuitName: string;
	entityId: string;
	watts: number;
	trend: TrendDirection;
	capacityPercent: number; // 0-100
	panelName: string;
}

export interface SolarReading {
	production: number; // watts currently producing
	todayWh: number; // watt-hours produced today
	netWatts: number; // negative = exporting to grid
	lifetimeKwh: number; // total lifetime production
	gridImportW: number; // watts importing from grid
	gridExportW: number; // watts exporting to grid
}

export interface EnergySnapshot {
	totalWatts: number;
	circuits: CircuitReading[];
	solar: SolarReading | null;
	timestamp: string; // ISO 8601
}

// --- History ---

export interface HistoryPoint {
	timestamp: string;
	watts: number;
}

export interface CircuitHistory {
	circuitId: number;
	circuitName: string;
	panelName: string;
	points: HistoryPoint[];
	avgWatts: number;
	maxWatts: number;
	totalKwh: number;
}

// --- Solar ---

export interface SolarSummary {
	currentProduction: number; // watts
	todayKwh: number;
	monthKwh: number;
	lifetimeKwh: number;
	selfConsumptionRatio: number; // 0-1
}

// --- Cost ---

export interface CostEstimate {
	dailyCost: number;
	monthlyCost: number;
	ratePerKwh: number;
}

// --- Capacity Alerts ---

export type AlertSeverity = 'warning' | 'critical';

export interface CapacityAlert {
	circuitId: number;
	circuitName: string;
	severity: AlertSeverity;
	currentAmps: number;
	ratedAmps: number;
	percent: number;
	message: string;
}

// --- HA Entity Discovery ---

export interface HAEntity {
	entityId: string;
	friendlyName: string;
	state: string;
	unitOfMeasurement: string;
	deviceClass: string | null;
	lastChanged: string;
}

// --- API Response Types ---

export interface LiveSSEData {
	total: number;
	circuits: CircuitReading[];
	solar: SolarReading | null;
	cost: CostEstimate;
	alerts: CapacityAlert[];
	timestamp: string;
}

export interface HistoryResponse {
	range: TimeRange;
	circuits: CircuitHistory[];
	totalPoints: HistoryPoint[];
	summary: HistoricalSummary;
	window: 'rolling' | 'today';
}

export interface HistoricalComparison {
	previousNetExportKwh: number;
	deltaNetExportKwh: number;
	direction: 'up' | 'down' | 'flat';
	previousConsumedKwh: number | null;
	deltaConsumedKwh: number | null;
	usageChangePercent: number | null;
}

export interface HistoricalTopConsumer {
	circuitId: number;
	circuitName: string;
	totalKwh: number;
}

export interface HistoricalSummary {
	startTime: string;
	endTime: string;
	durationHours: number;
	totalConsumedKwh: number;
	avgConsumedWatts: number;
	maxConsumedWatts: number;
	totalProducedKwh: number | null;
	avgProducedWatts: number | null;
	netImportKwh: number | null;
	netExportKwh: number | null;
	selfSufficiency: number | null;
	topConsumer: HistoricalTopConsumer | null;
	comparison: HistoricalComparison | null;
	partial: {
		solarUnavailable: boolean;
		gridUnavailable: boolean;
	};
}

export interface SolarResponse {
	current: SolarReading;
	summary: SolarSummary;
	history: HistoryPoint[];
}

export interface MappingResponse {
	mappings: EntityMapping[];
	unmappedEntities: HAEntity[];
	haConnected: boolean;
}
