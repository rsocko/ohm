/**
 * Fuzzy matching utilities for electrical record disambiguation.
 *
 * Uses trigram similarity + token overlap to handle cases like:
 * - "master bedroom" vs "Primary Bedroom"
 * - "kitchen lights" vs "Kitchen Ceiling Lights"
 * - "GFCI outlet" vs "Counter GFCI"
 */

/**
 * Generate character trigrams from a string.
 * Pads with spaces for edge trigrams.
 */
export function trigrams(s: string): Set<string> {
	const padded = ` ${s.toLowerCase()} `;
	const result = new Set<string>();
	for (let i = 0; i < padded.length - 2; i++) {
		result.add(padded.slice(i, i + 3));
	}
	return result;
}

/**
 * Trigram similarity (Dice coefficient) between two strings.
 * Returns 0..1 where 1 is identical.
 */
export function trigramSimilarity(a: string, b: string): number {
	const tA = trigrams(a);
	const tB = trigrams(b);
	if (tA.size === 0 && tB.size === 0) return 1;
	if (tA.size === 0 || tB.size === 0) return 0;
	let intersection = 0;
	for (const t of tA) {
		if (tB.has(t)) intersection++;
	}
	return (2 * intersection) / (tA.size + tB.size);
}

/**
 * Tokenize a string into lowercase words, stripping punctuation.
 */
function tokenize(s: string): string[] {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length > 0);
}

/**
 * Token overlap score: fraction of query tokens found in the candidate.
 * Returns 0..1 where 1 means all query tokens appear in the candidate.
 */
export function tokenOverlap(query: string, candidate: string): number {
	const qTokens = tokenize(query);
	const cTokens = new Set(tokenize(candidate));
	if (qTokens.length === 0) return 0;
	let matches = 0;
	for (const t of qTokens) {
		// Partial token match: "bed" matches "bedroom"
		if (cTokens.has(t) || [...cTokens].some((ct) => ct.includes(t) || t.includes(ct))) {
			matches++;
		}
	}
	return matches / qTokens.length;
}

/**
 * Combined fuzzy match score. Weights trigram similarity and token overlap.
 * Returns 0..1.
 */
export function fuzzyScore(query: string, candidate: string): number {
	const tSim = trigramSimilarity(query, candidate);
	const tOver = tokenOverlap(query, candidate);
	// Token overlap is more important for multi-word queries
	return tSim * 0.4 + tOver * 0.6;
}

export interface FuzzyMatch<T> {
	item: T;
	score: number;
	label: string;
}

/**
 * Find the best matches for a query against a list of labeled items.
 * Returns matches sorted by score descending, filtered by threshold.
 */
export function findBestMatches<T>(
	query: string,
	items: T[],
	getLabel: (item: T) => string,
	options?: { threshold?: number; maxResults?: number }
): FuzzyMatch<T>[] {
	const threshold = options?.threshold ?? 0.3;
	const maxResults = options?.maxResults ?? 5;

	const scored = items.map((item) => {
		const label = getLabel(item);
		return { item, score: fuzzyScore(query, label), label };
	});

	return scored
		.filter((m) => m.score >= threshold)
		.sort((a, b) => b.score - a.score)
		.slice(0, maxResults);
}
