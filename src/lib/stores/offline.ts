/**
 * IndexedDB persistence layer for offline support.
 * Stores all NocoDB table data locally so the app works read-only when offline.
 * Also caches image URLs for Service Worker pre-caching.
 */

const DB_NAME = 'electrical-config-offline';
const DB_VERSION = 1;
const DATA_STORE = 'tableData';
const META_STORE = 'meta';

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(DATA_STORE)) {
				db.createObjectStore(DATA_STORE);
			}
			if (!db.objectStoreNames.contains(META_STORE)) {
				db.createObjectStore(META_STORE);
			}
		};
	});
}

/** Persist all table data to IndexedDB */
export async function persistData(data: Record<string, unknown[]>): Promise<void> {
	try {
		const db = await openDB();
		const tx = db.transaction([DATA_STORE, META_STORE], 'readwrite');
		const store = tx.objectStore(DATA_STORE);
		const meta = tx.objectStore(META_STORE);

		for (const [table, records] of Object.entries(data)) {
			store.put(records, table);
		}
		meta.put(Date.now(), 'lastSyncedAt');

		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		db.close();
	} catch (e) {
		console.warn('[Offline] Failed to persist data to IndexedDB:', e);
	}
}

/** Load all table data from IndexedDB (returns null if nothing cached) */
export async function loadCachedData(): Promise<{ data: Record<string, unknown[]>; lastSyncedAt: number } | null> {
	try {
		const db = await openDB();
		const tx = db.transaction([DATA_STORE, META_STORE], 'readonly');
		const store = tx.objectStore(DATA_STORE);
		const meta = tx.objectStore(META_STORE);

		const tables = ['homes', 'panels', 'circuits', 'receptacles', 'loads', 'areas', 'floorplans'];
		const results: Record<string, unknown[]> = {};

		const promises = tables.map(
			(table) =>
				new Promise<void>((resolve) => {
					const req = store.get(table);
					req.onsuccess = () => {
						results[table] = req.result || [];
						resolve();
					};
					req.onerror = () => {
						results[table] = [];
						resolve();
					};
				})
		);

		const metaPromise = new Promise<number>((resolve) => {
			const req = meta.get('lastSyncedAt');
			req.onsuccess = () => resolve(req.result || 0);
			req.onerror = () => resolve(0);
		});

		await Promise.all(promises);
		const lastSyncedAt = await metaPromise;
		db.close();

		// Only return if we have some data
		if (results.areas?.length > 0 || results.loads?.length > 0) {
			return { data: results, lastSyncedAt };
		}
		return null;
	} catch (e) {
		console.warn('[Offline] Failed to load cached data from IndexedDB:', e);
		return null;
	}
}

/** Cache image URLs in IndexedDB so we know what to pre-cache */
export async function persistImageUrls(urls: string[]): Promise<void> {
	try {
		const db = await openDB();
		const tx = db.transaction(META_STORE, 'readwrite');
		const meta = tx.objectStore(META_STORE);
		meta.put(urls, 'cachedImageUrls');
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});
		db.close();
	} catch (e) {
		console.warn('[Offline] Failed to persist image URLs:', e);
	}
}

/** Get last sync timestamp */
export async function getLastSyncTime(): Promise<number | null> {
	try {
		const db = await openDB();
		const tx = db.transaction(META_STORE, 'readonly');
		const meta = tx.objectStore(META_STORE);
		const result = await new Promise<number | null>((resolve) => {
			const req = meta.get('lastSyncedAt');
			req.onsuccess = () => resolve(req.result || null);
			req.onerror = () => resolve(null);
		});
		db.close();
		return result;
	} catch {
		return null;
	}
}
