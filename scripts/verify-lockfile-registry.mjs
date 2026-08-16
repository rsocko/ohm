// Guards against dependency supply-chain drift: fails if package.json or
// package-lock.json reference anything other than the public npm registry
// (https://registry.npmjs.org/). This repo is public and must not depend on
// private feeds (e.g. Azure DevOps/Artifacts packagefeedproxy mirrors), git
// dependencies, or local/file: paths, since none of those are resolvable (or
// trustworthy) for anonymous contributors and public CI.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ALLOWED_RESOLVED_PREFIX = 'https://registry.npmjs.org/';

const DISALLOWED_SPEC_PATTERNS = [
	{ pattern: /^git\+/i, reason: 'git+ dependency specifier' },
	{ pattern: /^git:/i, reason: 'git: dependency specifier' },
	{ pattern: /^git@/i, reason: 'git SSH dependency specifier' },
	{ pattern: /^ssh:/i, reason: 'ssh: dependency specifier' },
	{ pattern: /^file:/i, reason: 'file: (local path) dependency specifier' },
	{ pattern: /^link:/i, reason: 'link: (local workspace) dependency specifier' },
	{ pattern: /^https?:\/\/(?!registry\.npmjs\.org\/)/i, reason: 'non-npmjs tarball URL dependency specifier' },
];

/**
 * Checks the dependency version specifiers declared in a parsed package.json
 * for git/file/link/private-URL sources.
 * @param {Record<string, unknown>} pkgJson
 * @returns {string[]} human-readable violation messages
 */
export function findDisallowedPackageJsonSpecs(pkgJson) {
	const violations = [];
	const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
	for (const field of fields) {
		const deps = pkgJson[field];
		if (!deps || typeof deps !== 'object') continue;
		for (const [name, spec] of Object.entries(deps)) {
			if (typeof spec !== 'string') continue;
			for (const { pattern, reason } of DISALLOWED_SPEC_PATTERNS) {
				if (pattern.test(spec)) {
					violations.push(`package.json ${field}["${name}"] = "${spec}" (${reason})`);
					break;
				}
			}
		}
	}
	return violations;
}

/**
 * Checks every "resolved" tarball URL in a parsed npm lockfile (v2/v3 shape,
 * i.e. the `packages` map) and flags anything that isn't served from the
 * public npm registry.
 * @param {Record<string, unknown>} lockJson
 * @returns {string[]} human-readable violation messages
 */
export function findDisallowedResolvedEntries(lockJson) {
	const violations = [];
	const packages = lockJson.packages;
	if (packages && typeof packages === 'object') {
		for (const [key, value] of Object.entries(packages)) {
			if (key === '' || !value || typeof value !== 'object') continue; // root project entry
			const entry = /** @type {Record<string, unknown>} */ (value);
			if (entry.link === true) continue; // local workspace symlink, not a fetched dependency
			const resolved = entry.resolved;
			if (typeof resolved !== 'string') continue;
			if (!resolved.startsWith(ALLOWED_RESOLVED_PREFIX)) {
				violations.push(`package-lock.json packages["${key}"].resolved = "${resolved}" (not served from ${ALLOWED_RESOLVED_PREFIX})`);
			}
		}
	}

	// Older lockfile shape (v1) uses a flat "dependencies" tree instead of "packages".
	const deps = lockJson.dependencies;
	if (deps && typeof deps === 'object') {
		collectV1Violations(/** @type {Record<string, unknown>} */ (deps), violations);
	}

	return violations;
}

/**
 * @param {Record<string, unknown>} deps
 * @param {string[]} violations
 * @param {string} [pathPrefix]
 */
function collectV1Violations(deps, violations, pathPrefix = '') {
	for (const [name, value] of Object.entries(deps)) {
		if (!value || typeof value !== 'object') continue;
		const entry = /** @type {Record<string, unknown>} */ (value);
		const label = `${pathPrefix}${name}`;
		if (typeof entry.resolved === 'string' && !entry.resolved.startsWith(ALLOWED_RESOLVED_PREFIX)) {
			violations.push(`package-lock.json dependencies["${label}"].resolved = "${entry.resolved}" (not served from ${ALLOWED_RESOLVED_PREFIX})`);
		}
		if (entry.dependencies && typeof entry.dependencies === 'object') {
			collectV1Violations(/** @type {Record<string, unknown>} */ (entry.dependencies), violations, `${label}>`);
		}
	}
}

/**
 * Runs the full guard against the given package.json / package-lock.json
 * contents (already parsed as JS objects).
 * @param {{ pkgJson: Record<string, unknown>, lockJson: Record<string, unknown> }} input
 * @returns {string[]}
 */
export function verifyRegistrySources({ pkgJson, lockJson }) {
	return [...findDisallowedPackageJsonSpecs(pkgJson), ...findDisallowedResolvedEntries(lockJson)];
}

function main() {
	const pkgJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	const lockJson = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

	const violations = verifyRegistrySources({ pkgJson, lockJson });

	if (violations.length > 0) {
		console.error(`Found ${violations.length} disallowed dependency source(s):\n`);
		for (const v of violations) console.error(`  - ${v}`);
		console.error(
			'\nThis repository is public and must only depend on the public npm registry ' +
				`(${ALLOWED_RESOLVED_PREFIX}). Regenerate package-lock.json using a public-registry ` +
				'install and remove any git/file/link specifiers from package.json.',
		);
		process.exitCode = 1;
		return;
	}

	console.log(`OK: all dependency sources resolve to ${ALLOWED_RESOLVED_PREFIX}`);
}

// Only run when executed directly (not when imported for tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main();
}
