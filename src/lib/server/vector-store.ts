/**
 * In-memory vector store for semantic search.
 *
 * Embeds ~200 records (circuits, rooms, loads, panels, receptacles) using
 * the configured LLM provider's embedding endpoint. Supports hybrid ranking
 * that combines text-match score with cosine similarity.
 *
 * Re-indexes periodically or on-demand via reindex().
 */

import { createOpenAI } from '@ai-sdk/openai';
import { embedMany, embed } from 'ai';
import { getAiConfig } from './ai-config';
import { db } from './db';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VectorDocument {
	id: string;
	/** e.g. 'circuit', 'room', 'load', 'panel', 'receptacle' */
	type: string;
	/** Human-readable label */
	label: string;
	/** The text that was embedded */
	content: string;
	/** Reference IDs for deep linking */
	refId: number;
	/** Extra metadata for display */
	meta: Record<string, unknown>;
}

interface StoredDocument extends VectorDocument {
	embedding: number[];
}

export interface SemanticSearchResult {
	document: VectorDocument;
	score: number;
	textScore: number;
	semanticScore: number;
}

// ─── Cosine similarity ───────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

// ─── Embedding provider ──────────────────────────────────────────────────────

const EMBEDDING_MODEL = 'text-embedding-3-small';

async function getEmbeddingProvider() {
	const config = await getAiConfig();

	// When Bifrost is the active provider, route embeddings through it too —
	// avoids requiring a separate OpenAI API key just for embeddings.
	if (config.llmProvider === 'bifrost') {
		return createOpenAI({ baseURL: config.bifrostUrl, apiKey: 'bifrost' });
	}

	// Prefer OpenAI for embeddings if key is configured
	if (config.openaiApiKey) {
		return createOpenAI({ apiKey: config.openaiApiKey });
	}

	// Fall back to Ollama (supports /v1/embeddings for compatible models)
	if (config.llmProvider === 'ollama') {
		return createOpenAI({
			baseURL: `${config.ollamaUrl}/v1`,
			apiKey: 'ollama'
		});
	}

	// Open-WebUI as last resort
	return createOpenAI({
		baseURL: `${config.openWebUiUrl}/api`,
		apiKey: config.openWebUiApiKey
	});
}

async function getEmbeddingModelId(): Promise<string> {
	const config = await getAiConfig();
	// OpenAI/Bifrost use text-embedding-3-small; Ollama uses nomic-embed-text or similar
	if (config.llmProvider === 'bifrost') return EMBEDDING_MODEL;
	if (config.openaiApiKey) return EMBEDDING_MODEL;
	if (config.llmProvider === 'ollama') return 'nomic-embed-text';
	return EMBEDDING_MODEL;
}

// ─── Store ───────────────────────────────────────────────────────────────────

let documents: StoredDocument[] = [];
let indexedAt: number | null = null;
let indexing = false;

const REINDEX_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/** Build a text description for embedding from a domain record */
function buildCircuitText(c: { number: number; description?: string; amps: number; panelName?: string; roomName?: string; breakerType?: string }): string {
	const parts = [`Circuit #${c.number}`, `${c.amps}A`];
	if (c.description) parts.push(c.description);
	if (c.panelName) parts.push(`panel: ${c.panelName}`);
	if (c.roomName) parts.push(`room: ${c.roomName}`);
	if (c.breakerType) parts.push(`breaker: ${c.breakerType}`);
	return parts.join(' | ');
}

function buildRoomText(r: { name: string; floor?: string; description?: string; homeName?: string }): string {
	const parts = [r.name];
	if (r.floor) parts.push(`floor: ${r.floor}`);
	if (r.description) parts.push(r.description);
	if (r.homeName) parts.push(`home: ${r.homeName}`);
	return parts.join(' | ');
}

function buildLoadText(l: { name: string; deviceType?: string; wattage?: number; roomName?: string; circuitNumber?: number }): string {
	const parts = [l.name];
	if (l.deviceType) parts.push(`type: ${l.deviceType}`);
	if (l.wattage) parts.push(`${l.wattage}W`);
	if (l.roomName) parts.push(`room: ${l.roomName}`);
	if (l.circuitNumber) parts.push(`circuit #${l.circuitNumber}`);
	return parts.join(' | ');
}

function buildPanelText(p: { name: string; location?: string; serviceSize?: number; homeName?: string }): string {
	const parts = [p.name];
	if (p.location) parts.push(`location: ${p.location}`);
	if (p.serviceSize) parts.push(`${p.serviceSize}A service`);
	if (p.homeName) parts.push(`home: ${p.homeName}`);
	return parts.join(' | ');
}

function buildReceptacleText(r: { name: string; type?: string; roomName?: string; circuitNumber?: number; locDirection?: string }): string {
	const parts = [r.name];
	if (r.type) parts.push(`type: ${r.type}`);
	if (r.roomName) parts.push(`room: ${r.roomName}`);
	if (r.circuitNumber) parts.push(`circuit #${r.circuitNumber}`);
	if (r.locDirection) parts.push(`wall: ${r.locDirection}`);
	return parts.join(' | ');
}

/** Collect all records into documents for embedding */
async function collectDocuments(): Promise<VectorDocument[]> {
	const docs: VectorDocument[] = [];

	const [rooms, panels, circuits, loads, receptacles] = await Promise.all([
		db.getRooms(),
		db.getPanels(),
		db.getCircuits(),
		db.getLoads(),
		db.getReceptacles()
	]);

	for (const room of rooms) {
		docs.push({
			id: `room-${room.id}`,
			type: 'room',
			label: room.name,
			content: buildRoomText(room),
			refId: room.id,
			meta: { floor: room.floor, homeName: room.homeName }
		});
	}

	for (const panel of panels) {
		docs.push({
			id: `panel-${panel.id}`,
			type: 'panel',
			label: panel.name,
			content: buildPanelText(panel),
			refId: panel.id,
			meta: { serviceSize: panel.serviceSize, location: panel.location }
		});
	}

	for (const circuit of circuits) {
		docs.push({
			id: `circuit-${circuit.id}`,
			type: 'circuit',
			label: `Circuit #${circuit.number}${circuit.description ? ` - ${circuit.description}` : ''}`,
			content: buildCircuitText(circuit),
			refId: circuit.id,
			meta: { number: circuit.number, amps: circuit.amps, panelName: circuit.panelName }
		});
	}

	for (const load of loads) {
		docs.push({
			id: `load-${load.id}`,
			type: 'load',
			label: load.name,
			content: buildLoadText(load),
			refId: load.id,
			meta: { wattage: load.wattage, deviceType: load.deviceType, roomName: load.roomName }
		});
	}

	for (const receptacle of receptacles) {
		docs.push({
			id: `receptacle-${receptacle.id}`,
			type: 'receptacle',
			label: receptacle.name,
			content: buildReceptacleText(receptacle),
			refId: receptacle.id,
			meta: { type: receptacle.type, roomName: receptacle.roomName }
		});
	}

	return docs;
}

/** Generate embeddings for a batch of texts */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return [];

	const provider = await getEmbeddingProvider();
	const modelId = await getEmbeddingModelId();

	const { embeddings } = await embedMany({
		model: provider.embedding(modelId),
		values: texts
	});

	return embeddings;
}

/** Index all records. Safe to call concurrently — only one indexing runs at a time. */
export async function reindex(): Promise<{ documentCount: number; durationMs: number }> {
	if (indexing) {
		return { documentCount: documents.length, durationMs: 0 };
	}

	indexing = true;
	const start = Date.now();

	try {
		const docs = await collectDocuments();

		// Batch embed all documents
		const texts = docs.map(d => d.content);
		const embeddings = await generateEmbeddings(texts);

		// Store
		documents = docs.map((doc, i) => ({
			...doc,
			embedding: embeddings[i]
		}));

		indexedAt = Date.now();
		const durationMs = indexedAt - start;
		console.log(`[Vector Store] Indexed ${documents.length} documents in ${durationMs}ms`);
		return { documentCount: documents.length, durationMs };
	} catch (err) {
		console.error('[Vector Store] Indexing failed:', err);
		throw err;
	} finally {
		indexing = false;
	}
}

/** Ensure the index is built (lazy init + periodic refresh) */
async function ensureIndex(): Promise<void> {
	if (documents.length === 0 || (indexedAt && Date.now() - indexedAt > REINDEX_INTERVAL_MS)) {
		await reindex();
	}
}

// ─── Search ──────────────────────────────────────────────────────────────────

/** Simple text-match score (0–1) based on substring matching */
function textMatchScore(query: string, doc: VectorDocument): number {
	const q = query.toLowerCase();
	const content = doc.content.toLowerCase();
	const label = doc.label.toLowerCase();

	// Exact label match
	if (label === q) return 1.0;
	// Label contains query
	if (label.includes(q)) return 0.8;
	// Content contains query
	if (content.includes(q)) return 0.6;

	// Word-level matching
	const words = q.split(/\s+/).filter(w => w.length > 1);
	if (words.length === 0) return 0;
	const matchCount = words.filter(w => content.includes(w) || label.includes(w)).length;
	return (matchCount / words.length) * 0.5;
}

/**
 * Hybrid semantic search — combines text matching with vector similarity.
 * Returns results sorted by combined score.
 */
export async function semanticSearch(
	query: string,
	options: { limit?: number; typeFilter?: string; textWeight?: number; semanticWeight?: number } = {}
): Promise<SemanticSearchResult[]> {
	const { limit = 20, typeFilter, textWeight = 0.3, semanticWeight = 0.7 } = options;

	await ensureIndex();

	if (documents.length === 0) {
		return [];
	}

	// Generate query embedding
	const provider = await getEmbeddingProvider();
	const modelId = await getEmbeddingModelId();
	const { embedding: queryEmbedding } = await embed({
		model: provider.embedding(modelId),
		value: query
	});

	// Score all documents
	let candidates = typeFilter
		? documents.filter(d => d.type === typeFilter)
		: documents;

	const scored: SemanticSearchResult[] = candidates.map(doc => {
		const semanticScore = cosineSimilarity(queryEmbedding, doc.embedding);
		const txtScore = textMatchScore(query, doc);
		const combinedScore = (txtScore * textWeight) + (semanticScore * semanticWeight);

		return {
			document: {
				id: doc.id,
				type: doc.type,
				label: doc.label,
				content: doc.content,
				refId: doc.refId,
				meta: doc.meta
			},
			score: combinedScore,
			textScore: txtScore,
			semanticScore
		};
	});

	// Sort by combined score and return top results
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, limit).filter(r => r.score > 0.1);
}

/** Get index status */
export function getIndexStatus(): { indexed: boolean; documentCount: number; indexedAt: number | null; isIndexing: boolean } {
	return {
		indexed: documents.length > 0,
		documentCount: documents.length,
		indexedAt,
		isIndexing: indexing
	};
}
