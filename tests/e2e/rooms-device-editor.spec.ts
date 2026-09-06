import { expect, test } from '@playwright/test';
import {
	getDemoRecordById,
	getDemoRecords,
	getDemoTables
} from '../../src/lib/server/demo/nocodb-data';

test('device edit mode keeps the rooms UI responsive', async ({ page }) => {
	const pageErrors: Error[] = [];
	page.on('pageerror', (error) => pageErrors.push(error));

	await page.route('**/api/nocodb**', async (route) => {
		const request = route.request();
		if (request.method() === 'PATCH') {
			await route.fulfill({ json: { success: true } });
			return;
		}

		const url = new URL(request.url());
		const action = url.searchParams.get('action');
		const tableName = url.searchParams.get('table');
		const table = getDemoTables().find((candidate) => candidate.title === tableName);

		if (action === 'tables') {
			await route.fulfill({ json: { tables: getDemoTables() } });
		} else if (action === 'records' && table) {
			const records = structuredClone(getDemoRecords(table.id));
			if (table.title === 'Receptacle') {
				for (const record of records) {
					const circuit = record.fields.Circuit;
					if (circuit && typeof circuit === 'object' && 'id' in circuit) {
						const linkedCircuit = circuit as { id: number; value?: unknown };
						record.fields.Circuit = {
							...linkedCircuit,
							fields: { Name: String(linkedCircuit.value ?? linkedCircuit.id) }
						};
					}
				}
			}
			await route.fulfill({ json: { records } });
		} else if (action === 'record' && table) {
			const id = Number(url.searchParams.get('id'));
			await route.fulfill({ json: { record: getDemoRecordById(table.id, id) } });
		} else {
			await route.fulfill({ status: 404, json: { error: 'Not found' } });
		}
	});

	await page.goto('/rooms');
	await page.getByRole('button', { name: 'Loads', exact: true }).click();

	const room = page.locator('[data-area-id]').filter({
		has: page.getByRole('heading', { name: 'Kitchen' })
	});
	await room.getByRole('button', { name: 'Devices' }).click();

	const firstDeviceEdit = room.locator('button[title="Edit"]').nth(1);
	await firstDeviceEdit.click();
	await expect(page.getByPlaceholder('Display name')).toBeVisible();

	await page.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByPlaceholder('Display name')).not.toBeVisible();

	await firstDeviceEdit.click();
	await expect(page.getByPlaceholder('Display name')).toBeVisible();
	await page.getByRole('button', { name: 'Plan' }).click();
	await expect(page.getByPlaceholder('Display name')).not.toBeVisible();
	expect(pageErrors).toEqual([]);
});
