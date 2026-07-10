import { describe, it, expect } from 'vitest';
import {
	inferEntityFromDescription,
	inferDeviceType,
	inferReceptacleType,
	resolveEntityAlias,
	resolveDirection
} from '../src/lib/server/db/vocabulary';

describe('inferEntityFromDescription', () => {
	it('identifies dimmer as Receptacle', () => {
		const result = inferEntityFromDescription('dimmer');
		expect(result).not.toBeNull();
		expect(result!.table).toBe('Receptacle');
		expect(result!.typeValue).toBe('Dimmer Switch');
	});

	it('identifies ceiling fan as Load', () => {
		const result = inferEntityFromDescription('ceiling fan');
		expect(result).not.toBeNull();
		expect(result!.table).toBe('Load');
		expect(result!.typeValue).toBe('Fan');
	});

	it('identifies outlet as Receptacle', () => {
		const result = inferEntityFromDescription('outlet');
		expect(result).not.toBeNull();
		expect(result!.table).toBe('Receptacle');
		expect(result!.typeValue).toBe('Outlet');
	});

	it('identifies GFCI as Receptacle', () => {
		const result = inferEntityFromDescription('GFCI');
		expect(result).not.toBeNull();
		expect(result!.table).toBe('Receptacle');
		expect(result!.typeValue).toBe('GFCI Outlet');
	});

	it('identifies recessed cans as Load', () => {
		const result = inferEntityFromDescription('recessed cans');
		expect(result).not.toBeNull();
		expect(result!.table).toBe('Load');
		expect(result!.typeValue).toBe('Light');
	});

	it('identifies 3-way switch as Receptacle', () => {
		const result = inferEntityFromDescription('3-way switch');
		expect(result).not.toBeNull();
		expect(result!.table).toBe('Receptacle');
		expect(result!.typeValue).toBe('3-Way Switch');
	});

	it('identifies refrigerator as Load', () => {
		const result = inferEntityFromDescription('refrigerator');
		expect(result).not.toBeNull();
		expect(result!.table).toBe('Load');
		expect(result!.typeValue).toBe('Appliance');
	});

	it('identifies EV charger as Load', () => {
		const result = inferEntityFromDescription('ev charger');
		expect(result).not.toBeNull();
		expect(result!.table).toBe('Load');
		expect(result!.typeValue).toBe('EV');
	});

	it('returns null for ambiguous input', () => {
		const result = inferEntityFromDescription('something');
		expect(result).toBeNull();
	});

	it('handles phrases with extra context', () => {
		const result = inferEntityFromDescription('a smart dimmer for the lights');
		expect(result).not.toBeNull();
		expect(result!.table).toBe('Receptacle');
	});
});

describe('resolveEntityAlias', () => {
	it('resolves "room" to Area', () => {
		expect(resolveEntityAlias('room')).toBe('Area');
	});

	it('resolves "house" to Home', () => {
		expect(resolveEntityAlias('house')).toBe('Home');
	});

	it('resolves "breaker box" to Panel', () => {
		expect(resolveEntityAlias('breaker box')).toBe('Panel');
	});

	it('resolves "outlet" to Receptacle', () => {
		expect(resolveEntityAlias('outlet')).toBe('Receptacle');
	});

	it('passes through unknown terms', () => {
		expect(resolveEntityAlias('something random')).toBe('something random');
	});
});

describe('inferDeviceType', () => {
	it('infers Light from "recessed"', () => {
		expect(inferDeviceType('recessed')).toBe('Light');
	});

	it('infers Fan from "exhaust fan"', () => {
		expect(inferDeviceType('exhaust fan')).toBe('Fan');
	});

	it('infers HVAC from "mini split"', () => {
		expect(inferDeviceType('mini split')).toBe('HVAC');
	});

	it('returns undefined for unknown', () => {
		expect(inferDeviceType('quantum flux capacitor')).toBeUndefined();
	});
});

describe('inferReceptacleType', () => {
	it('infers Dimmer Switch from "dimmer"', () => {
		expect(inferReceptacleType('dimmer')).toBe('Dimmer Switch');
	});

	it('infers GFCI Outlet from "gfi"', () => {
		expect(inferReceptacleType('gfi')).toBe('GFCI Outlet');
	});

	it('infers 3-Way Switch from "three way"', () => {
		expect(inferReceptacleType('three way')).toBe('3-Way Switch');
	});
});

describe('resolveDirection', () => {
	it('resolves "north wall" to N', () => {
		expect(resolveDirection('north wall')).toBe('N');
	});

	it('resolves "ceiling" to Ceiling', () => {
		expect(resolveDirection('ceiling')).toBe('Ceiling');
	});

	it('passes through unknown direction', () => {
		expect(resolveDirection('behind the couch')).toBe('behind the couch');
	});
});
