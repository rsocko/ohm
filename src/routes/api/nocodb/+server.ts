import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	listTables,
	getRecords,
	getRecordById,
	getTableByName,
	searchAllTables,
	updateRecord,
	deleteRecord,
	createRecord,
	getTableMeta,
	replaceLinks,
	supplementSystemLinks
} from '$lib/server/nocodb';

export const GET: RequestHandler = async ({ url }) => {
	const action = url.searchParams.get('action');
	const table = url.searchParams.get('table');
	const query = url.searchParams.get('q');
	const id = url.searchParams.get('id');

	try {
		if (action === 'tables') {
			const tables = await listTables();
			return json({ tables });
		}

		// Single record by ID
		if (action === 'record' && table && id) {
			const t = await getTableByName(table);
			if (!t) return json({ error: `Table "${table}" not found` }, { status: 404 });
			const record = await getRecordById(t.id, Number(id));
			if (!record) return json({ error: 'Record not found' }, { status: 404 });
			return json({ record });
		}

		if (action === 'records' && table) {
			const t = await getTableByName(table);
			if (!t) return json({ error: `Table "${table}" not found` }, { status: 404 });
			const where = url.searchParams.get('where') || undefined;
			const rawLimit = parseInt(url.searchParams.get('limit') || '50', 10);
			const pageSize = String(Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 500));
			const records = await getRecords(t.id, { pageSize, ...(where ? { where } : {}) });
			// Supplement system link fields that v3 API excludes
			if (table.toLowerCase() === 'load') {
				await supplementSystemLinks(t.id, records, 'Network_Upstream');
			}
			if (table.toLowerCase() === 'floorplan') {
				await supplementSystemLinks(t.id, records, 'Home');
			}
			return json({ records });
		}

		if (action === 'search' && query) {
			const results = await searchAllTables(query);
			return json({ results });
		}

		return json({ error: 'Invalid action. Use: tables, records, record, search' }, { status: 400 });
	} catch (err) {
		console.error('NocoDB API error:', err);
		return json({ error: 'Failed to fetch data' }, { status: 500 });
	}
};

/**
 * PATCH /api/nocodb
 * Body: {
 *   table: string,
 *   id: number,
 *   fields?: Record<string, unknown>,
 *   linkUpdates?: { title: string; ids: number[] }[]
 * }
 */
export const PATCH: RequestHandler = async ({ request }) => {
	try {
		const { table, id, fields, linkUpdates } = await request.json();
		const hasFields = !!fields && Object.keys(fields).length > 0;
		const hasLinkUpdates = Array.isArray(linkUpdates) && linkUpdates.length > 0;
		if (!table || !id || (!hasFields && !hasLinkUpdates)) {
			return json({ error: 'table, id, and either fields or linkUpdates are required' }, { status: 400 });
		}
		const t = await getTableByName(table);
		if (!t) return json({ error: `Table "${table}" not found` }, { status: 404 });
		if (hasFields) {
			await updateRecord(t.id, id, fields);
		}
		if (hasLinkUpdates) {
			const meta = await getTableMeta(t.id);
			const columns = (meta.columns as Array<{ id: string; title: string; uidt: string }> | undefined) || [];
			for (const update of linkUpdates as Array<{ title: string; ids: number[] }>) {
				const linkColumn = columns.find((column) => column.title === update.title && column.uidt === 'LinkToAnotherRecord');
				if (!linkColumn) {
					return json({ error: `Link column "${update.title}" not found on ${table}` }, { status: 400 });
				}
				await replaceLinks(t.id, linkColumn.id, Number(id), Array.isArray(update.ids) ? update.ids : []);
			}
		}
		return json({ success: true, id, fields: fields ?? {}, linkUpdates: linkUpdates ?? [] });
	} catch (err) {
		console.error('NocoDB PATCH error:', err);
		return json({ error: 'Failed to update record' }, { status: 500 });
	}
};

/**
 * DELETE /api/nocodb?table=Load&id=123
 */
export const DELETE: RequestHandler = async ({ url }) => {
	try {
		const table = url.searchParams.get('table');
		const id = url.searchParams.get('id');
		if (!table || !id) {
			return json({ error: 'table and id query params are required' }, { status: 400 });
		}
		const t = await getTableByName(table);
		if (!t) return json({ error: `Table "${table}" not found` }, { status: 404 });
		await deleteRecord(t.id, Number(id));
		return json({ success: true });
	} catch (err) {
		console.error('NocoDB DELETE error:', err);
		return json({ error: 'Failed to delete record' }, { status: 500 });
	}
};

/**
 * POST /api/nocodb
 * Body: {
 *   table: string,
 *   fields: Record<string, unknown>,
 *   linkUpdates?: { title: string; ids: number[] }[]
 * }
 * Creates a new record in the specified table.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const { table, fields, linkUpdates } = await request.json();
		if (!table || !fields) {
			return json({ error: 'table and fields are required' }, { status: 400 });
		}
		const t = await getTableByName(table);
		if (!t) return json({ error: `Table "${table}" not found` }, { status: 404 });
		const record = await createRecord(t.id, fields);
		if (Array.isArray(linkUpdates) && linkUpdates.length > 0 && record.id) {
			const meta = await getTableMeta(t.id);
			const columns = (meta.columns as Array<{ id: string; title: string; uidt: string }> | undefined) || [];
			for (const update of linkUpdates as Array<{ title: string; ids: number[] }>) {
				const linkColumn = columns.find((col) => col.title === update.title && col.uidt === 'LinkToAnotherRecord');
				if (linkColumn) {
					await replaceLinks(t.id, linkColumn.id, Number(record.id), update.ids);
				}
			}
		}
		return json({ success: true, record });
	} catch (err) {
		console.error('NocoDB POST error:', err);
		return json({ error: 'Failed to create record' }, { status: 500 });
	}
};