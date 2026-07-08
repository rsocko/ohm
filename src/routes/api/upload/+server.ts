import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uploadFile, getTableByName, createRecord, updateRecord } from '$lib/server/nocodb';

/**
 * POST /api/upload
 * Accepts multipart form data with:
 * - file: the image file (or base64 data URL in 'data' field for paste)
 * - table: target NocoDB table name
 * - recordId: (optional) existing record ID to attach to
 * - field: the attachment field name on the record
 * - fields: (optional) JSON string of additional fields for new record creation
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const formData = await request.formData();
		const table = formData.get('table') as string;
		const field = formData.get('field') as string;
		const recordId = formData.get('recordId') as string | null;
		const extraFields = formData.get('fields') as string | null;

		if (!table || !field) {
			return json({ error: 'table and field are required' }, { status: 400 });
		}

		let fileBuffer: Uint8Array;
		let filename: string;
		let mimetype: string;

		// Handle file upload OR base64 paste data
		const file = formData.get('file') as File | null;
		const dataUrl = formData.get('data') as string | null;

		if (file) {
			fileBuffer = new Uint8Array(await file.arrayBuffer());
			filename = file.name || 'upload.png';
			mimetype = file.type || 'image/png';
		} else if (dataUrl) {
			// Parse data URL: data:image/png;base64,iVBOR...
			const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
			if (!match) {
				return json({ error: 'Invalid data URL format' }, { status: 400 });
			}
			mimetype = match[1];
			const ext = mimetype.split('/')[1] || 'png';
			filename = `floorplan-${Date.now()}.${ext}`;
			fileBuffer = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
		} else {
			return json({ error: 'No file or data provided' }, { status: 400 });
		}

		// Upload to NocoDB storage
		const uploaded = await uploadFile(fileBuffer, filename, mimetype);

		// Get table info
		const t = await getTableByName(table);
		if (!t) return json({ error: `Table "${table}" not found` }, { status: 404 });

		// Attach to existing record or create new one
		const attachmentValue = [uploaded];

		if (recordId) {
			// Update existing record's attachment field
			await updateRecord(t.id, Number(recordId), { [field]: attachmentValue });
			return json({ success: true, recordId: Number(recordId), attachment: uploaded });
		} else {
			// Create new record with the attachment + any extra fields
			const fields: Record<string, unknown> = { [field]: attachmentValue };
			if (extraFields) {
				Object.assign(fields, JSON.parse(extraFields));
			}
			const record = await createRecord(t.id, fields);
			return json({ success: true, record, attachment: uploaded });
		}
	} catch (err) {
		console.error('Upload error:', err);
		return json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 });
	}
};
