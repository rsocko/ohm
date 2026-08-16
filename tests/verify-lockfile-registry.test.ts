import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	ALLOWED_RESOLVED_PREFIX,
	findDisallowedPackageJsonSpecs,
	findDisallowedResolvedEntries,
	verifyRegistrySources,
} from '../scripts/verify-lockfile-registry.mjs';

describe('verify-lockfile-registry guard', () => {
	it('allows package.json specs that use ordinary semver ranges', () => {
		const pkgJson = {
			dependencies: { svelte: '^5.56.1' },
			devDependencies: { vitest: '^3.2.1' },
		};
		expect(findDisallowedPackageJsonSpecs(pkgJson)).toEqual([]);
	});

	it.each([
		['git+ dependency', { dependencies: { foo: 'git+https://github.com/foo/foo.git' } }],
		['git protocol dependency', { dependencies: { foo: 'git://github.com/foo/foo.git' } }],
		['file: local path dependency', { devDependencies: { foo: 'file:../local-foo' } }],
		['link: local workspace dependency', { dependencies: { foo: 'link:../local-foo' } }],
		['workspace dependency', { dependencies: { foo: 'workspace:*' } }],
		['GitHub shorthand dependency', { dependencies: { foo: 'github:foo/foo' } }],
		['bare repository shorthand dependency', { dependencies: { foo: 'foo/foo#main' } }],
		['a private feed tarball URL', { dependencies: { foo: 'https://ms-feed-1.pkgs.visualstudio.com/foo/-/foo-1.0.0.tgz' } }],
	])('flags %s in package.json', (_label, pkgJson) => {
		const violations = findDisallowedPackageJsonSpecs(pkgJson);
		expect(violations.length).toBeGreaterThan(0);
	});

	it('flags nested override and resolution sources', () => {
		const pkgJson = {
			overrides: { parent: { child: 'git+https://github.com/foo/child.git' } },
			resolutions: { other: 'file:../other' },
		};
		expect(findDisallowedPackageJsonSpecs(pkgJson)).toHaveLength(2);
	});

	it('allows lockfile entries resolved from the public npm registry', () => {
		const lockJson = {
			packages: {
				'': { name: 'ohm' },
				'node_modules/svelte': {
					version: '5.56.1',
					resolved: `${ALLOWED_RESOLVED_PREFIX}svelte/-/svelte-5.56.1.tgz`,
					integrity: 'sha512-abc123==',
				},
			},
		};
		expect(findDisallowedResolvedEntries(lockJson)).toEqual([]);
	});

	it('skips local workspace link entries', () => {
		const lockJson = {
			packages: {
				'': { name: 'ohm' },
				'node_modules/@ohm/local-pkg': { link: true, resolved: '../packages/local-pkg' },
			},
		};
		expect(findDisallowedResolvedEntries(lockJson)).toEqual([]);
	});

	it('flags a lockfile entry resolved via a private feed proxy', () => {
		const lockJson = {
			packages: {
				'': { name: 'ohm' },
				'node_modules/marked': {
					version: '18.0.5',
					resolved:
						'https://ms-feed-2.pkgs.visualstudio.com/1es-public/_packaging/npm-public/npm/registry/marked/-/marked-18.0.5.tgz',
					integrity: 'sha512-abc123==',
				},
			},
		};
		const violations = findDisallowedResolvedEntries(lockJson);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain('node_modules/marked');
	});

	it('flags a v1-shaped lockfile entry resolved via a disallowed host', () => {
		const lockJson = {
			dependencies: {
				marked: {
					version: '18.0.5',
					resolved: 'https://packagefeedproxy.microsoft.io/npm/marked/-/marked-18.0.5.tgz',
					dependencies: {
						nested: {
							version: '1.0.0',
							resolved: 'git+https://github.com/foo/nested.git',
						},
					},
				},
			},
		};
		const violations = findDisallowedResolvedEntries(lockJson);
		expect(violations).toHaveLength(2);
	});

	it('combines package.json and lockfile violations in verifyRegistrySources', () => {
		const pkgJson = { dependencies: { foo: 'git+https://github.com/foo/foo.git' } };
		const lockJson = {
			packages: {
				'': { name: 'ohm' },
				'node_modules/foo': { version: '1.0.0', resolved: 'git+https://github.com/foo/foo.git' },
			},
		};
		expect(verifyRegistrySources({ pkgJson, lockJson })).toHaveLength(2);
	});

	it('keeps the patched cookie transitive override in the lockfile', () => {
		const lockJson = JSON.parse(
			readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
		);
		expect(lockJson.packages['node_modules/cookie'].version).toBe('0.7.2');
	});
});
