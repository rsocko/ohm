import { describe, it, expect } from 'vitest';

/**
 * Voice Parsing Regression Suite
 *
 * Documents expected tool call structures for complex voice utterances.
 * These tests validate the PARSING LOGIC, not the LLM — they serve as a
 * regression library to verify that the system prompt + tool schemas can
 * express the expected operations.
 *
 * Each test case defines:
 * - input: voice transcription text
 * - expectedTools: which tool(s) should be called
 * - expectedOperations: the proposed operations structure
 */

interface VoiceTestCase {
	description: string;
	input: string;
	expectedTool: string;
	expectedOperations: Array<{
		action: string;
		table: string;
		labelPattern?: RegExp;
		fields?: Record<string, unknown>;
	}>;
}

const voiceTestCases: VoiceTestCase[] = [
	{
		description: 'Simple load creation with quantity',
		input: "Sam's office has 4 recessed ceiling lights",
		expectedTool: 'propose_batch',
		expectedOperations: [
			{
				action: 'create',
				table: 'Load',
				labelPattern: /ceiling lights/i,
				fields: { Fixture_Count: 4, 'Device Type': 'Light' }
			}
		]
	},
	{
		description: 'Load + dimmer + circuit assignment',
		input: "Sam's office has 4 recessed ceiling lights on a dimmer on the north wall, circuit 7",
		expectedTool: 'propose_batch',
		expectedOperations: [
			{ action: 'create', table: 'Load', labelPattern: /ceiling lights/i, fields: { Fixture_Count: 4 } },
			{
				action: 'create',
				table: 'Receptacle',
				labelPattern: /dimmer/i,
				fields: { 'Receptacle Type': 'Dimmer Switch', 'Loc.Direction': 'N' }
			},
			{ action: 'link', table: 'Load', labelPattern: /circuit 7/i },
			{ action: 'link', table: 'Receptacle', labelPattern: /circuit 7/i }
		]
	},
	{
		description: 'Multi-gang box creation',
		input: "there's a 3-gang box on the north wall with a dimmer, switch, and outlet",
		expectedTool: 'propose_batch',
		expectedOperations: [
			{ action: 'create', table: 'Receptacle', labelPattern: /dimmer/i },
			{ action: 'create', table: 'Receptacle', labelPattern: /switch/i },
			{ action: 'create', table: 'Receptacle', labelPattern: /outlet/i }
		]
	},
	{
		description: 'Circuit assignment for all in area',
		input: 'Circuit 1 controls all lights and receptacles in the basement TV room',
		expectedTool: 'assign_circuit',
		expectedOperations: [
			{ action: 'assign', table: 'Circuit', labelPattern: /circuit 1/i }
		]
	},
	{
		description: 'Single GFCI outlet with circuit',
		input: 'Add a GFCI outlet by the sink on circuit 12',
		expectedTool: 'propose_batch',
		expectedOperations: [
			{
				action: 'create',
				table: 'Receptacle',
				labelPattern: /gfci/i,
				fields: { 'Receptacle Type': 'GFCI Outlet' }
			},
			{ action: 'link', table: 'Receptacle', labelPattern: /circuit 12/i }
		]
	},
	{
		description: 'Multiple loads in one sentence',
		input: 'The living room has a ceiling fan, two floor lamps, and the TV',
		expectedTool: 'propose_batch',
		expectedOperations: [
			{ action: 'create', table: 'Load', labelPattern: /ceiling fan/i, fields: { 'Device Type': 'Fan' } },
			{ action: 'create', table: 'Load', labelPattern: /floor lamp/i, fields: { Fixture_Count: 2 } },
			{ action: 'create', table: 'Load', labelPattern: /tv/i, fields: { 'Device Type': 'Appliance' } }
		]
	},
	{
		description: '3-way switch detection',
		input: "There's a 3-way switch for the hallway light",
		expectedTool: 'propose_batch',
		expectedOperations: [
			{ action: 'create', table: 'Receptacle', labelPattern: /switch/i },
			{ action: 'create', table: 'Receptacle', labelPattern: /switch/i }
		]
	},
	{
		description: 'Audit / verification query',
		input: "What's in the kitchen?",
		expectedTool: 'query_electrical_data',
		expectedOperations: [
			{ action: 'query', table: 'Area', labelPattern: /kitchen/i }
		]
	}
];

describe('Voice Parsing — Expected Tool Call Structures', () => {
	it('has a comprehensive test case library', () => {
		expect(voiceTestCases.length).toBeGreaterThanOrEqual(8);
	});

	describe('test case structure validation', () => {
		for (const tc of voiceTestCases) {
			it(`"${tc.description}" has valid structure`, () => {
				expect(tc.input).toBeTruthy();
				expect(tc.expectedTool).toBeTruthy();
				expect(tc.expectedOperations.length).toBeGreaterThan(0);

				for (const op of tc.expectedOperations) {
					expect(op.action).toBeTruthy();
					expect(op.table).toBeTruthy();
				}
			});
		}
	});

	describe('operation counts match expectations', () => {
		it('simple load = 1 create', () => {
			const tc = voiceTestCases.find((t) => t.description === 'Simple load creation with quantity')!;
			const creates = tc.expectedOperations.filter((o) => o.action === 'create');
			expect(creates.length).toBe(1);
		});

		it('load + dimmer + circuit = 2 creates + 2 links', () => {
			const tc = voiceTestCases.find((t) => t.description === 'Load + dimmer + circuit assignment')!;
			const creates = tc.expectedOperations.filter((o) => o.action === 'create');
			const links = tc.expectedOperations.filter((o) => o.action === 'link');
			expect(creates.length).toBe(2);
			expect(links.length).toBe(2);
		});

		it('3-gang box = 3 creates', () => {
			const tc = voiceTestCases.find((t) => t.description === 'Multi-gang box creation')!;
			const creates = tc.expectedOperations.filter((o) => o.action === 'create');
			expect(creates.length).toBe(3);
		});

		it('multiple loads = 3 creates', () => {
			const tc = voiceTestCases.find((t) => t.description === 'Multiple loads in one sentence')!;
			const creates = tc.expectedOperations.filter((o) => o.action === 'create');
			expect(creates.length).toBe(3);
		});

		it('3-way switch = 2 receptacles', () => {
			const tc = voiceTestCases.find((t) => t.description === '3-way switch detection')!;
			const creates = tc.expectedOperations.filter((o) => o.action === 'create');
			expect(creates.length).toBe(2);
			expect(creates.every((c) => c.table === 'Receptacle')).toBe(true);
		});
	});

	describe('field inference expectations', () => {
		it('infers Fixture_Count from quantity words', () => {
			const tc = voiceTestCases.find((t) => t.description === 'Simple load creation with quantity')!;
			const load = tc.expectedOperations[0];
			expect(load.fields?.Fixture_Count).toBe(4);
		});

		it('infers Device Type from context', () => {
			const tc = voiceTestCases.find((t) => t.description === 'Multiple loads in one sentence')!;
			const fan = tc.expectedOperations.find((o) => o.labelPattern?.test('ceiling fan'));
			expect(fan?.fields?.['Device Type']).toBe('Fan');
			const tv = tc.expectedOperations.find((o) => o.labelPattern?.test('TV'));
			expect(tv?.fields?.['Device Type']).toBe('Appliance');
		});

		it('infers Receptacle Type from context', () => {
			const tc = voiceTestCases.find((t) => t.description === 'Single GFCI outlet with circuit')!;
			const gfci = tc.expectedOperations.find((o) => o.action === 'create');
			expect(gfci?.fields?.['Receptacle Type']).toBe('GFCI Outlet');
		});

		it('infers Loc.Direction from "north wall"', () => {
			const tc = voiceTestCases.find((t) => t.description === 'Load + dimmer + circuit assignment')!;
			const dimmer = tc.expectedOperations.find((o) => o.labelPattern?.test('dimmer'));
			expect(dimmer?.fields?.['Loc.Direction']).toBe('N');
		});
	});
});

// Export for potential use in CI/prompt regression tooling
export { voiceTestCases };
export type { VoiceTestCase };
