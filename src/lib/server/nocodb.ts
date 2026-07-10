import { env } from '$env/dynamic/private';

const NOCODB_URL = env.NOCODB_URL || 'http://nocodb.example.com';
const NOCODB_TOKEN = env.NOCODB_API_TOKEN || '';
const BASE_ID = env.NOCODB_BASE_ID || 'pt7ylnikbprtaqy';

export interface Table {
	id: string;
	title: string;
}

export interface V3Record {
	id: number;
	id_fields: Record<string, unknown>;
	fields: Record<string, unknown>;
}

interface V3RecordsResponse {
	records: V3Record[];
	next: string | null;
	nestedNext: string | null;
}

async function nocodbFetch(path: string, params?: Record<string, string>): Promise<unknown> {
	const url = new URL(path, NOCODB_URL);
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}
	}
	const resp = await fetch(url.toString(), {
		headers: {
			'xc-token': NOCODB_TOKEN,
			'Content-Type': 'application/json'
		}
	});
	if (!resp.ok) {
		throw new Error(`NocoDB API error: ${resp.status} ${resp.statusText}`);
	}
	return resp.json();
}

export async function listTables(): Promise<Table[]> {
	const data = (await nocodbFetch(`/api/v3/meta/bases/${BASE_ID}/tables`)) as {
		list?: Table[];
	};
	return data.list || [];
}

export async function getRecords(
	tableId: string,
	params?: Record<string, string>
): Promise<V3Record[]> {
	const data = (await nocodbFetch(
		`/api/v3/data/${BASE_ID}/${tableId}/records`,
		params
	)) as V3RecordsResponse;
	return data.records || [];
}

export async function getRecordById(
	tableId: string,
	recordId: number
): Promise<V3Record | null> {
	try {
		const data = (await nocodbFetch(
			`/api/v3/data/${BASE_ID}/${tableId}/records/${recordId}`
		)) as V3Record;
		return data || null;
	} catch {
		return null;
	}
}

export async function getTableByName(name: string): Promise<Table | undefined> {
	const tables = await listTables();
	return tables.find((t) => t.title.toLowerCase() === name.toLowerCase());
}

export async function getTableMeta(tableId: string): Promise<Record<string, unknown>> {
	return (await nocodbFetch(`/api/v2/meta/tables/${tableId}`)) as Record<string, unknown>;
}

export async function searchAllTables(query: string): Promise<Record<string, V3Record[]>> {
	const tables = await listTables();
	const results: Record<string, V3Record[]> = {};
	const queryLower = query.toLowerCase();

	for (const table of tables) {
		const records = await getRecords(table.id, { pageSize: '100' });
		const matches = records.filter((record) =>
			Object.entries(record.fields).some(([key, value]) => {
				if (key.startsWith('nc_') || ['CreatedAt', 'UpdatedAt'].includes(key)) return false;
				return typeof value === 'string' && value.toLowerCase().includes(queryLower);
			})
		);
		if (matches.length > 0) {
			results[table.title] = matches;
		}
	}
	return results;
}

export async function updateRecord(
	tableId: string,
	recordId: number,
	fields: Record<string, unknown>
): Promise<void> {
	const url = new URL(`/api/v2/tables/${tableId}/records`, NOCODB_URL);
	const resp = await fetch(url.toString(), {
		method: 'PATCH',
		headers: {
			'xc-token': NOCODB_TOKEN,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify([{ Id: recordId, ...fields }])
	});
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`NocoDB PATCH failed: ${resp.status} ${text}`);
	}
}

export async function deleteRecord(
	tableId: string,
	recordId: number
): Promise<void> {
	const url = new URL(`/api/v2/tables/${tableId}/records`, NOCODB_URL);
	const resp = await fetch(url.toString(), {
		method: 'DELETE',
		headers: {
			'xc-token': NOCODB_TOKEN,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify([{ Id: recordId }])
	});
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`NocoDB DELETE failed: ${resp.status} ${text}`);
	}
}

export async function replaceLinks(
	tableId: string,
	columnId: string,
	recordId: number,
	linkedIds: number[]
): Promise<void> {
	const url = new URL(`/api/v2/tables/${tableId}/links/${columnId}/records/${recordId}`, NOCODB_URL);
	const headers = {
		'xc-token': NOCODB_TOKEN,
		'Content-Type': 'application/json'
	};

	const currentResp = await fetch(url.toString(), { headers });
	if (!currentResp.ok) {
		const text = await currentResp.text();
		throw new Error(`NocoDB link lookup failed: ${currentResp.status} ${text}`);
	}

	const currentData = await currentResp.json();
	const existing = Array.isArray(currentData?.list) ? currentData.list : [];

	if (existing.length > 0) {
		const deleteResp = await fetch(url.toString(), {
			method: 'DELETE',
			headers,
			body: JSON.stringify(existing.map((entry: { Id?: number; id?: number }) => ({ Id: entry.Id ?? entry.id })))
		});
		if (!deleteResp.ok) {
			const text = await deleteResp.text();
			throw new Error(`NocoDB link delete failed: ${deleteResp.status} ${text}`);
		}
	}

	if (linkedIds.length === 0) return;

	const createResp = await fetch(url.toString(), {
		method: 'POST',
		headers,
		body: JSON.stringify(linkedIds.map((id) => ({ Id: id })))
	});
	if (!createResp.ok) {
		const text = await createResp.text();
		throw new Error(`NocoDB link create failed: ${createResp.status} ${text}`);
	}
}

export interface LinkColumn {
	id: string;
	title: string;
	fk_related_model_id: string;
	type?: string; // 'bt' | 'hm' | 'mm'
}

/**
 * Get link/LTAR columns for a table. Used to resolve column IDs
 * for linking records (e.g., Circuit → Load).
 */
export async function getLinkColumns(tableId: string): Promise<LinkColumn[]> {
	const meta = await getTableMeta(tableId);
	const columns = (meta.columns || []) as Array<Record<string, unknown>>;
	return columns
		.filter((c) => c.uidt === 'LinkToAnotherRecord' || c.uidt === 'Links')
		.map((c) => {
			const colOptions = (c.colOptions || {}) as Record<string, unknown>;
			return {
				id: c.id as string,
				title: c.title as string,
				// BelongsTo columns store fk_related_model_id in colOptions, not at root
				fk_related_model_id: (c.fk_related_model_id || colOptions.fk_related_model_id) as string,
				type: colOptions.type as string | undefined
			};
		});
}

/**
 * Add links without removing existing ones (unlike replaceLinks which clears first).
 */
export async function addLinks(
	tableId: string,
	columnId: string,
	recordId: number,
	linkedIds: number[]
): Promise<void> {
	if (linkedIds.length === 0) return;
	const url = new URL(`/api/v2/tables/${tableId}/links/${columnId}/records/${recordId}`, NOCODB_URL);
	const resp = await fetch(url.toString(), {
		method: 'POST',
		headers: {
			'xc-token': NOCODB_TOKEN,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(linkedIds.map((id) => ({ Id: id })))
	});
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`NocoDB link add failed: ${resp.status} ${text}`);
	}
}

/**
 * Upload a file to NocoDB storage and return the attachment metadata.
 * Uses the v2 storage upload endpoint.
 */
export async function uploadFile(
	file: Buffer | Uint8Array,
	filename: string,
	mimetype: string
): Promise<{ path: string; title: string; mimetype: string; signedPath: string }> {
	const url = new URL('/api/v2/storage/upload', NOCODB_URL);
	const formData = new FormData();
	const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
	const blobBytes = new Uint8Array(bytes.byteLength);
	blobBytes.set(bytes);
	const blob = new Blob([blobBytes], { type: mimetype });
	formData.append('file', blob, filename);

	const resp = await fetch(url.toString(), {
		method: 'POST',
		headers: {
			'xc-token': NOCODB_TOKEN
		},
		body: formData
	});
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`NocoDB upload failed: ${resp.status} ${text}`);
	}
	const data = await resp.json();
	// NocoDB returns an array of uploaded files
	const uploaded = Array.isArray(data) ? data[0] : data;
	return uploaded;
}

/**
 * Create a new record in a table. Returns the created record.
 */
export async function createRecord(
	tableId: string,
	fields: Record<string, unknown>
): Promise<V3Record> {
	const url = new URL(`/api/v2/tables/${tableId}/records`, NOCODB_URL);
	const resp = await fetch(url.toString(), {
		method: 'POST',
		headers: {
			'xc-token': NOCODB_TOKEN,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify([fields])
	});
	if (!resp.ok) {
		const text = await resp.text();
		throw new Error(`NocoDB POST failed: ${resp.status} ${text}`);
	}
	const data = await resp.json();
	const raw = Array.isArray(data) ? data[0] : data;
	// NocoDB v2 returns Id (capital); normalize to our V3Record shape
	return { id: raw.Id ?? raw.id, id_fields: {}, fields: raw };
}

/**
 * Supplement v3 records with system link fields that v3 API excludes.
 * Fetches via v2 API and merges the link data into the records.
 */
export async function supplementSystemLinks(
	tableId: string,
	records: V3Record[],
	linkColumnTitle: string
): Promise<void> {
	if (records.length === 0) return;
	// Use v2 API which includes system fields
	const url = new URL(`/api/v2/tables/${tableId}/records`, NOCODB_URL);
	url.searchParams.set('fields', `Id,${linkColumnTitle}`);
	url.searchParams.set('limit', '200');
	const resp = await fetch(url.toString(), {
		headers: { 'xc-token': NOCODB_TOKEN }
	});
	if (!resp.ok) return;
	const data = await resp.json();
	const v2Records = Array.isArray(data?.list) ? data.list : [];
	// Build map of id → link value
	const linkMap = new Map<number, unknown>();
	for (const r of v2Records) {
		const id = r.Id ?? r.id;
		const linkVal = r[linkColumnTitle];
		if (id && linkVal) linkMap.set(id, linkVal);
	}
	// Merge into v3 records
	for (const rec of records) {
		const linkVal = linkMap.get(rec.id);
		if (linkVal) {
			// Normalize to V3Record-like shape for consistency
			if (typeof linkVal === 'object' && linkVal !== null && 'Id' in linkVal) {
				const obj = linkVal as Record<string, unknown>;
				rec.fields[linkColumnTitle] = { id: obj.Id ?? obj.id, id_fields: { Id: obj.Id }, fields: obj };
			} else {
				rec.fields[linkColumnTitle] = linkVal;
			}
		}
	}
}
