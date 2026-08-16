/**
 * Live integration test — exercises real NocoDB CRUD and linking against a
 * real, operator-configured NocoDB instance. Creates a test home, rooms,
 * loads, receptacles. Verifies links. Cleans up.
 *
 * This test is NEVER part of the default `npm test` suite or CI — it's excluded
 * from vitest.config.ts and only discovered via vitest.live.config.ts. It also
 * requires all of the environment variables below (including the explicit
 * NOCODB_LIVE_TEST=1 opt-in) to be set, or it fails immediately with a clear
 * error instead of silently skipping or contacting any default/fallback host.
 *
 * Run with (all required):
 *   NOCODB_LIVE_TEST=1 NOCODB_URL=https://your-nocodb-host \
 *     NOCODB_API_TOKEN=your_token NOCODB_BASE_ID=your_base_id \
 *     npm run test:live
 *
 * IMPORTANT: Creates and deletes real data using "___TEST___" prefix. Never
 * commit real credentials/hostnames/base IDs — always pass them via the
 * environment at run time.
 */

import { describe, it, expect, afterAll } from 'vitest';

const LIVE_TEST_ENABLED = process.env.NOCODB_LIVE_TEST === '1';
const NOCODB_URL = process.env.NOCODB_URL;
const NOCODB_TOKEN = process.env.NOCODB_API_TOKEN;
const BASE_ID = process.env.NOCODB_BASE_ID;

const hasRequiredConfig = Boolean(NOCODB_URL && NOCODB_TOKEN && BASE_ID);

if (LIVE_TEST_ENABLED && !hasRequiredConfig) {
	// Explicitly opted in but missing config — fail loudly rather than skip quietly.
	throw new Error(
		'NOCODB_LIVE_TEST=1 requires NOCODB_URL, NOCODB_API_TOKEN, and NOCODB_BASE_ID ' +
			'to all be set in the environment. See tests/integration/live-mcp.test.ts for usage.'
	);
}

const runLive = LIVE_TEST_ENABLED && hasRequiredConfig;

const cleanup: { table: string; id: number }[] = [];

async function api(method: string, path: string, body?: unknown) {
	const resp = await fetch(`${NOCODB_URL}${path}`, {
		method,
		headers: { 'xc-token': NOCODB_TOKEN as string, 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined
	});
	if (!resp.ok) {
		// Report status only — never echo upstream response bodies, which may
		// contain other records' data from the live instance.
		throw new Error(`NocoDB ${method} ${path} → ${resp.status} ${resp.statusText}`);
	}
	const ct = resp.headers.get('content-type') || '';
	if (ct.includes('application/json')) return resp.json();
	return null;
}

async function getTableId(name: string): Promise<string> {
	const meta = await api('GET', `/api/v2/meta/bases/${BASE_ID}/tables`);
	const t = meta.list.find((t: any) => t.title === name);
	if (!t) throw new Error(`Table "${name}" not found. Have: ${meta.list.map((x: any) => x.title).join(', ')}`);
	return t.id;
}

async function createRecord(tableId: string, fields: Record<string, unknown>) {
	return api('POST', `/api/v2/tables/${tableId}/records`, fields);
}

async function getRecord(tableId: string, id: number) {
	return api('GET', `/api/v2/tables/${tableId}/records/${id}`);
}

async function deleteRecord(tableId: string, id: number) {
	return api('DELETE', `/api/v2/tables/${tableId}/records`, { Id: id });
}

async function getLinkColumns(tableId: string) {
	const meta = await api('GET', `/api/v2/meta/tables/${tableId}`);
	return meta.columns.filter((c: any) => c.uidt === 'LinkToAnotherRecord' || c.uidt === 'Links');
}

async function linkRecords(tableId: string, linkColId: string, recordId: number, targetIds: number[]) {
	return api('POST', `/api/v2/tables/${tableId}/links/${linkColId}/records/${recordId}`, targetIds.map(id => ({ Id: id })));
}

const TEST_PREFIX = '___TEST___';

// Skipped entirely unless explicitly enabled via NOCODB_LIVE_TEST=1 plus full config above.
describe.skipIf(!runLive)('Live NocoDB Integration', () => {
	let tables: Record<string, string> = {};
	let testHomeId: number;
	let testAreaId: number;
	let testLoadId: number;
	let testReceptacleId: number;

	it('resolves all table IDs', async () => {
		tables.Home = await getTableId('Home');
		tables.Area = await getTableId('Area');
		tables.Load = await getTableId('Load');
		tables.Receptacle = await getTableId('Receptacle');
		tables.Circuit = await getTableId('Circuit');
		tables.Panel = await getTableId('Panel');
		expect(Object.keys(tables).length).toBe(6);
	}, 15000);

	it('creates test home', async () => {
		const r = await createRecord(tables.Home, {
			Name: `${TEST_PREFIX}Integration Home`,
			Address: '123 Test St',
			City: 'Testville',
			State: 'MA',
			ZipCode: '00000',
			HomeId: 'TSTH'
		});
		testHomeId = r.Id;
		cleanup.push({ table: tables.Home, id: testHomeId });
		expect(testHomeId).toBeGreaterThan(0);
	}, 10000);

	it('creates test area and links to home', async () => {
		const r = await createRecord(tables.Area, {
			Name: `${TEST_PREFIX}Test Kitchen`,
			Floor: 'Main',
			AreaId: 'TKIT'
		});
		testAreaId = r.Id;
		cleanup.push({ table: tables.Area, id: testAreaId });

		const linkCols = await getLinkColumns(tables.Area);
		const homeCol = linkCols.find((c: any) => 
			c.title.toLowerCase().includes('home')
		);
		expect(homeCol).toBeTruthy();
		if (homeCol) {
			await linkRecords(tables.Area, homeCol.id, testAreaId, [testHomeId]);
		}
		expect(testAreaId).toBeGreaterThan(0);
	}, 15000);

	it('creates test load and links to area', async () => {
		const r = await createRecord(tables.Load, {
			Name: `${TEST_PREFIX}Test Ceiling Light`,
			'Device Type': 'Light - Ceiling',
			Wattage: 60,
			Fixture_Count: 3
		});
		testLoadId = r.Id;
		cleanup.push({ table: tables.Load, id: testLoadId });

		const linkCols = await getLinkColumns(tables.Load);
		const areaCol = linkCols.find((c: any) =>
			c.title.toLowerCase().includes('area')
		);
		expect(areaCol).toBeTruthy();
		if (areaCol) {
			await linkRecords(tables.Load, areaCol.id, testLoadId, [testAreaId]);
		}
		expect(testLoadId).toBeGreaterThan(0);
	}, 15000);

	it('creates test receptacle and links to area', async () => {
		const r = await createRecord(tables.Receptacle, {
			Name: `${TEST_PREFIX}Test Dimmer`,
			'Receptacle Type': 'Dimmer Switch',
			'Loc.Direction': 'N - North',
			'Loc.Placement': 'W - Wall'
		});
		testReceptacleId = r.Id;
		cleanup.push({ table: tables.Receptacle, id: testReceptacleId });

		const linkCols = await getLinkColumns(tables.Receptacle);
		const areaCol = linkCols.find((c: any) =>
			c.title.toLowerCase().includes('area')
		);
		if (areaCol) {
			await linkRecords(tables.Receptacle, areaCol.id, testReceptacleId, [testAreaId]);
		}
		expect(testReceptacleId).toBeGreaterThan(0);
	}, 15000);

	it('reads back home with correct fields', async () => {
		const home = await getRecord(tables.Home, testHomeId);
		expect(home.Name).toBe(`${TEST_PREFIX}Integration Home`);
		expect(home.City).toBe('Testville');
		expect(home.HomeId).toBe('TSTH');
	}, 10000);

	it('reads back area with correct fields', async () => {
		const area = await getRecord(tables.Area, testAreaId);
		expect(area.Name).toBe(`${TEST_PREFIX}Test Kitchen`);
		expect(area.Floor).toBe('Main');
	}, 10000);

	it('reads back load with correct fields and wattage type', async () => {
		const load = await getRecord(tables.Load, testLoadId);
		expect(load.Name).toBe(`${TEST_PREFIX}Test Ceiling Light`);
		expect(load['Device Type']).toBe('Light - Ceiling');
		expect(load.Wattage).toBe(60);
		expect(typeof load.Wattage).toBe('number');
		expect(load.Fixture_Count).toBe(3);
	}, 10000);

	it('reads back receptacle with correct fields', async () => {
		const rec = await getRecord(tables.Receptacle, testReceptacleId);
		expect(rec.Name).toBe(`${TEST_PREFIX}Test Dimmer`);
		expect(rec['Receptacle Type']).toBe('Dimmer Switch');
		expect(rec['Loc.Direction']).toBe('N - North');
	}, 10000);

	it('verifies area→home link exists', async () => {
		const area = await getRecord(tables.Area, testAreaId);
		// NocoDB returns linked records as objects or counts depending on view
		const homeField = Object.keys(area).find(k => k.toLowerCase().includes('home'));
		expect(homeField).toBeTruthy();
		if (homeField) {
			const val = area[homeField];
			// Could be: number (count), array of records, or nested object
			const linked = typeof val === 'number' ? val > 0 : 
				Array.isArray(val) ? val.length > 0 : !!val;
			expect(linked).toBe(true);
		}
	}, 10000);

	it('verifies load→area link exists', async () => {
		const load = await getRecord(tables.Load, testLoadId);
		const areaField = Object.keys(load).find(k => k.toLowerCase().includes('area'));
		expect(areaField).toBeTruthy();
		if (areaField) {
			const val = load[areaField];
			const linked = typeof val === 'number' ? val > 0 :
				Array.isArray(val) ? val.length > 0 : !!val;
			expect(linked).toBe(true);
		}
	}, 10000);

	it('can update a field (wattage 60→120)', async () => {
		await api('PATCH', `/api/v2/tables/${tables.Load}/records`, {
			Id: testLoadId,
			Wattage: 120
		});
		const updated = await getRecord(tables.Load, testLoadId);
		expect(updated.Wattage).toBe(120);
	}, 10000);

	it('can update a string field (rename)', async () => {
		await api('PATCH', `/api/v2/tables/${tables.Load}/records`, {
			Id: testLoadId,
			Name: `${TEST_PREFIX}Renamed Ceiling Light`
		});
		const updated = await getRecord(tables.Load, testLoadId);
		expect(updated.Name).toBe(`${TEST_PREFIX}Renamed Ceiling Light`);
	}, 10000);

	// Cleanup
	afterAll(async () => {
		console.log('\n  🧹 Cleaning up test data...');
		for (const item of cleanup.reverse()) {
			try {
				await deleteRecord(item.table, item.id);
				console.log(`    ✓ Deleted ${item.id}`);
			} catch (err: any) {
				console.error(`    ✗ Failed to delete ${item.id}: ${err.message}`);
			}
		}
		console.log('  ✅ Cleanup complete.\n');
	}, 30000);
});
