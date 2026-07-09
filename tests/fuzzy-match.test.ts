import { describe, it, expect } from 'vitest';
import {
	trigrams,
	trigramSimilarity,
	tokenOverlap,
	fuzzyScore,
	findBestMatches
} from '../src/lib/server/fuzzy-match';

describe('trigrams', () => {
	it('generates trigrams with padding', () => {
		const result = trigrams('ab');
		expect(result).toContain(' ab');
		expect(result).toContain('ab ');
		expect(result.size).toBe(2);
	});

	it('returns empty set for empty string', () => {
		const result = trigrams('');
		// ' ' padded = '  ' which has 0 trigrams (length 2, need 3)
		expect(result.size).toBeLessThanOrEqual(1);
	});

	it('is case insensitive', () => {
		const a = trigrams('Kitchen');
		const b = trigrams('kitchen');
		expect(a).toEqual(b);
	});
});

describe('trigramSimilarity', () => {
	it('returns 1 for identical strings', () => {
		expect(trigramSimilarity('kitchen', 'kitchen')).toBe(1);
	});

	it('returns 1 for case-insensitive identical strings', () => {
		expect(trigramSimilarity('Kitchen', 'kitchen')).toBe(1);
	});

	it('returns high score for similar strings', () => {
		const score = trigramSimilarity('kitchen', 'kitchn');
		expect(score).toBeGreaterThan(0.6);
	});

	it('returns low score for dissimilar strings', () => {
		const score = trigramSimilarity('kitchen', 'bathroom');
		expect(score).toBeLessThan(0.3);
	});

	it('handles empty strings', () => {
		expect(trigramSimilarity('', '')).toBe(1);
		expect(trigramSimilarity('kitchen', '')).toBe(0);
	});
});

describe('tokenOverlap', () => {
	it('returns 1 when all query tokens found in candidate', () => {
		expect(tokenOverlap('ceiling lights', 'Kitchen Ceiling Lights')).toBe(1);
	});

	it('handles partial token matches', () => {
		// "bed" should match "bedroom"
		const score = tokenOverlap('bed', 'Primary Bedroom');
		expect(score).toBe(1);
	});

	it('handles synonym-style mismatches', () => {
		// "master" won't match "primary" — no token overlap
		const score = tokenOverlap('master bedroom', 'Primary Bedroom');
		// "bedroom" matches, "master" doesn't match "primary"
		expect(score).toBe(0.5);
	});

	it('returns 0 for no overlap', () => {
		expect(tokenOverlap('kitchen', 'garage door')).toBe(0);
	});

	it('returns 0 for empty query', () => {
		expect(tokenOverlap('', 'anything')).toBe(0);
	});
});

describe('fuzzyScore', () => {
	it('returns high score for exact match', () => {
		expect(fuzzyScore('kitchen', 'Kitchen')).toBeGreaterThan(0.9);
	});

	it('returns decent score for partial name match', () => {
		// "ceiling lights" should score well against "Kitchen Ceiling Lights"
		const score = fuzzyScore('ceiling lights', 'Kitchen Ceiling Lights');
		expect(score).toBeGreaterThan(0.5);
	});

	it('returns low score for unrelated strings', () => {
		expect(fuzzyScore('bathroom', 'Circuit 7')).toBeLessThan(0.2);
	});
});

describe('findBestMatches', () => {
	const rooms = [
		{ id: 1, name: 'Kitchen' },
		{ id: 2, name: 'Primary Bedroom' },
		{ id: 3, name: 'Basement TV Room' },
		{ id: 4, name: "the project owner's Office" },
		{ id: 5, name: 'Garage' }
	];

	it('finds exact matches', () => {
		const results = findBestMatches('kitchen', rooms, (r) => r.name);
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].item.id).toBe(1);
	});

	it('finds partial matches', () => {
		const results = findBestMatches('tv room', rooms, (r) => r.name);
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].item.id).toBe(3);
	});

	it('ranks best match first', () => {
		const results = findBestMatches('bedroom', rooms, (r) => r.name);
		expect(results[0].item.id).toBe(2);
	});

	it('respects threshold', () => {
		const results = findBestMatches('xyz123', rooms, (r) => r.name, { threshold: 0.5 });
		expect(results.length).toBe(0);
	});

	it('respects maxResults', () => {
		const results = findBestMatches('room', rooms, (r) => r.name, { maxResults: 2 });
		expect(results.length).toBeLessThanOrEqual(2);
	});

	it('handles electrical jargon', () => {
		const devices = [
			{ id: 1, name: 'Counter GFCI' },
			{ id: 2, name: 'Island Dimmer' },
			{ id: 3, name: 'Sink GFCI Outlet' },
			{ id: 4, name: 'N-Wall Switch' }
		];

		const gfciResults = findBestMatches('GFCI outlet', devices, (d) => d.name);
		expect(gfciResults.length).toBeGreaterThanOrEqual(1);
		// Sink GFCI Outlet should rank high (both tokens match)
		const sinkMatch = gfciResults.find((m) => m.item.id === 3);
		expect(sinkMatch).toBeDefined();

		const dimmerResults = findBestMatches('dimmer switch', devices, (d) => d.name);
		expect(dimmerResults.length).toBeGreaterThanOrEqual(1);
		expect(dimmerResults[0].item.id).toBe(2);
	});
});
