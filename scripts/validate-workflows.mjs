// Structural policy validator for GitHub Actions workflows in this repository.
//
// This intentionally has zero npm dependencies (only Node.js built-ins) so it
// can run in CI *before* `npm ci`/`npm install`, using only the runtime that
// GitHub-hosted runners and `actions/setup-node` already provide. It includes
// a small YAML-subset parser tailored to the constructs actually used by our
// workflow files (block mappings, block sequences, quoted/plain scalars, and
// `|`/`>` block scalars). It is not a general-purpose YAML parser.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const workflowsDirectory = path.resolve('.github', 'workflows');
const workflowFiles = readdirSync(workflowsDirectory)
	.filter((file) => /\.ya?ml$/u.test(file))
	.sort();

assert.ok(workflowFiles.length > 0, 'At least one workflow is required');

// ---------------------------------------------------------------------------
// Minimal YAML-subset parser
// ---------------------------------------------------------------------------

function stripComment(line) {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < line.length; i += 1) {
		const ch = line[i];
		if (ch === "'" && !inDouble) inSingle = !inSingle;
		else if (ch === '"' && !inSingle) inDouble = !inDouble;
		else if (ch === '#' && !inSingle && !inDouble) {
			if (i === 0 || /\s/u.test(line[i - 1])) return line.slice(0, i);
		}
	}
	return line;
}

function parseScalar(raw) {
	const value = raw.trim();
	if (value === '') return null;
	if (value === 'null' || value === '~') return null;
	if (value === 'true') return true;
	if (value === 'false') return false;
	if (
		(value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
		(value.startsWith("'") && value.endsWith("'") && value.length >= 2)
	) {
		const quote = value[0];
		const inner = value.slice(1, -1);
		return quote === '"' ? inner.replace(/\\"/gu, '"') : inner.replace(/''/gu, "'");
	}
	if (/^-?\d+$/u.test(value)) return Number.parseInt(value, 10);
	return value;
}

function splitKeyValue(content) {
	// Find the first ": " (or trailing ":") that is not inside quotes, used as
	// the mapping key/value separator for a single logical line.
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < content.length; i += 1) {
		const ch = content[i];
		if (ch === "'" && !inDouble) inSingle = !inSingle;
		else if (ch === '"' && !inSingle) inDouble = !inDouble;
		else if (ch === ':' && !inSingle && !inDouble) {
			const next = content[i + 1];
			if (next === undefined || next === ' ') {
				return [content.slice(0, i).trim(), content.slice(i + 1).trim()];
			}
		}
	}
	return null;
}

function readBlockScalar(rawLines, startIndex, parentIndent, style) {
	const collected = [];
	let i = startIndex;
	while (i < rawLines.length) {
		const line = rawLines[i];
		if (line.trim() === '') {
			collected.push({ indent: Infinity, text: '' });
			i += 1;
			continue;
		}
		const indent = line.length - line.trimStart().length;
		if (indent <= parentIndent) break;
		collected.push({ indent, text: line });
		i += 1;
	}
	const baseIndent = Math.min(...collected.filter((l) => l.indent !== Infinity).map((l) => l.indent), Infinity);
	const contentLines = collected.map((l) => (l.indent === Infinity ? '' : l.text.slice(baseIndent)));
	let text;
	if (style === '|') {
		text = contentLines.join('\n');
	} else {
		// Folded style: blank lines become newlines, consecutive content lines join with a space.
		const parts = [];
		let paragraph = [];
		for (const l of contentLines) {
			if (l === '') {
				if (paragraph.length) parts.push(paragraph.join(' '));
				paragraph = [];
				parts.push('');
			} else {
				paragraph.push(l);
			}
		}
		if (paragraph.length) parts.push(paragraph.join(' '));
		text = parts.join('\n');
	}
	return { value: text, nextIndex: i };
}

function parseNode(logical, pos, minIndent) {
	if (pos >= logical.length || logical[pos].indent < minIndent) {
		return { value: null, nextPos: pos };
	}
	// The child block's own indent is whatever the first line actually uses
	// (commonly, but not necessarily, minIndent); siblings must match it exactly.
	const indent = logical[pos].indent;
	if (logical[pos].content.startsWith('- ') || logical[pos].content === '-') {
		return parseSequence(logical, pos, indent);
	}
	return parseMapping(logical, pos, indent);
}

function parseSequence(logical, pos, indent) {
	const result = [];
	let i = pos;
	while (i < logical.length && logical[i].indent === indent && (logical[i].content === '-' || logical[i].content.startsWith('- '))) {
		const rest = logical[i].content === '-' ? '' : logical[i].content.slice(2);
		if (rest === '') {
			const next = parseNode(logical, i + 1, indent + 1);
			result.push(next.value);
			i = next.nextPos;
			continue;
		}
		const kv = splitKeyValue(rest);
		if (kv) {
			// Sequence item is an inline mapping; reuse mapping parsing by
			// synthesizing a virtual indent for the continuation lines (indent + 2).
			const itemIndent = indent + 2;
			const { obj, nextPos } = parseMappingFromFirstPair(logical, i, itemIndent, kv);
			result.push(obj);
			i = nextPos;
		} else {
			result.push(parseScalar(rest));
			i += 1;
		}
	}
	return { value: result, nextPos: i };
}

function parseMappingFromFirstPair(logical, firstLineIndex, itemIndent, firstKv) {
	const obj = {};
	let i = assignPair(obj, logical, firstLineIndex, itemIndent, firstKv);
	while (i < logical.length && logical[i].indent === itemIndent) {
		const kv = splitKeyValue(logical[i].content);
		if (!kv) break;
		i = assignPair(obj, logical, i, itemIndent, kv);
	}
	return { obj, nextPos: i };
}

// `assignPair` mutates `obj` for the key/value pair starting at `logical[i]`
// and returns the index of the next unconsumed logical line.
function assignPair(obj, logical, i, indent, kv) {
	const [key, valueText] = kv;
	if (valueText === '' || valueText === undefined) {
		const next = parseNode(logical, i + 1, indent + 1);
		obj[key] = next.value;
		return next.nextPos;
	}
	if (valueText === '|' || valueText === '|-' || valueText === '|+' || valueText === '>' || valueText === '>-' || valueText === '>+') {
		const style = valueText[0];
		const rawStartLine = logical[i].rawIndex + 1;
		const block = readBlockScalar(rawLinesGlobal, rawStartLine, indent, style);
		obj[key] = block.value;
		const nextLogicalPos = logical.findIndex((l, idx) => idx > i && l.rawIndex >= block.nextIndex);
		return nextLogicalPos === -1 ? logical.length : nextLogicalPos;
	}
	obj[key] = parseScalar(valueText);
	return i + 1;
}

function parseMapping(logical, pos, indent) {
	const obj = {};
	let i = pos;
	while (i < logical.length && logical[i].indent === indent) {
		const kv = splitKeyValue(logical[i].content);
		if (!kv) break;
		i = assignPair(obj, logical, i, indent, kv);
	}
	return { value: obj, nextPos: i };
}

let rawLinesGlobal = [];

function parseYaml(text) {
	rawLinesGlobal = text.split(/\r?\n/u);
	const logical = [];
	for (let i = 0; i < rawLinesGlobal.length; i += 1) {
		const stripped = stripComment(rawLinesGlobal[i]);
		if (stripped.trim() === '') continue;
		const indent = stripped.length - stripped.trimStart().length;
		logical.push({ rawIndex: i, indent, content: stripped.trim() });
	}
	if (logical.length === 0) return {};
	const { value } = parseNode(logical, 0, 0);
	return value ?? {};
}

// ---------------------------------------------------------------------------
// Policy assertions
// ---------------------------------------------------------------------------

const hostedRunners = new Set(['ubuntu-24.04', 'ubuntu-22.04', 'ubuntu-latest']);
const permissionValues = new Set(['read', 'write', 'none']);
const allowedActions = new Set(['actions/attest', 'actions/checkout', 'actions/setup-node']);
let hasPullRequestWorkflow = false;

function validatePermissions(permissions, location) {
	assert.ok(
		permissions && typeof permissions === 'object' && !Array.isArray(permissions),
		`${location} must declare an explicit permissions map`,
	);
	for (const [permission, value] of Object.entries(permissions)) {
		assert.ok(permission !== 'actions' || value !== 'write', `${location} must not grant actions: write`);
		assert.ok(permissionValues.has(value), `${location}.${permission} has invalid value ${String(value)}`);
	}
}

function collectUses(value, results = []) {
	if (Array.isArray(value)) {
		for (const entry of value) collectUses(entry, results);
	} else if (value && typeof value === 'object') {
		for (const [key, entry] of Object.entries(value)) {
			if (key === 'uses') results.push(entry);
			collectUses(entry, results);
		}
	}
	return results;
}

for (const file of workflowFiles) {
	const filePath = path.join(workflowsDirectory, file);
	const source = readFileSync(filePath, 'utf8');
	const workflow = parseYaml(source);

	assert.ok(workflow && typeof workflow === 'object', `${file} must contain a YAML mapping`);
	assert.ok(workflow.on && typeof workflow.on === 'object', `${file} must declare event triggers`);
	assert.ok(!('pull_request_target' in workflow.on), `${file} must not use pull_request_target`);
	assert.ok(!('workflow_call' in workflow.on), `${file} must not be reusable by another workflow`);
	assert.doesNotMatch(
		source,
		/\$\{\{(?:(?!\}\})[\s\S])*\bsecrets\b/iu,
		`${file} must not reference protected secrets`,
	);
	validatePermissions(workflow.permissions, file);

	const handlesPullRequests = 'pull_request' in workflow.on;
	hasPullRequestWorkflow ||= handlesPullRequests;
	const hasWritePermissions =
		Object.values(workflow.permissions ?? {}).includes('write') ||
		Object.values(workflow.jobs ?? {}).some((job) =>
			Object.values(job.permissions ?? workflow.permissions ?? {}).includes('write'),
		);

	if (handlesPullRequests) {
		for (const [permission, value] of Object.entries(workflow.permissions)) {
			assert.notEqual(value, 'write', `${file} must not grant ${permission}: write on pull requests`);
		}
	}

	for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
		const location = `${file}:jobs.${jobName}`;
		assert.ok(!('uses' in job), `${location} must not call a reusable workflow`);
		assert.equal(typeof job['runs-on'], 'string', `${location}.runs-on must be a literal string`);
		assert.ok(hostedRunners.has(job['runs-on']), `${location}.runs-on must be an approved GitHub-hosted runner`);

		// A job may omit `permissions` to inherit the workflow-level grant
		// validated above; if it declares its own map, that map itself must
		// still be explicit and least-privilege.
		if (job.permissions !== undefined) {
			validatePermissions(job.permissions, location);
			if (handlesPullRequests) {
				for (const [permission, value] of Object.entries(job.permissions)) {
					assert.notEqual(value, 'write', `${location} must not grant ${permission}: write on pull requests`);
				}
			}
		}
	}

	if (hasWritePermissions) {
		assert.ok(!('push' in workflow.on), `${file} must not publish directly from a push event`);
		assert.ok(!('pull_request' in workflow.on), `${file} must not publish from pull requests`);
		assert.deepEqual(
			workflow.on.workflow_run,
			{ workflows: ['CI'], types: ['completed'] },
			`${file} publication must follow completion of the CI workflow`,
		);
		assert.deepEqual(
			workflow.on.workflow_dispatch?.inputs?.commit,
			{
				description: 'Full commit SHA from the main branch history to publish',
				required: true,
				type: 'string',
			},
			`${file} manual publication must require an explicit full commit SHA`,
		);
		assert.deepEqual(
			workflow.on.workflow_dispatch?.inputs?.version_mode,
			{
				description: 'How to determine the immutable image tag',
				required: true,
				type: 'choice',
				default: 'next_patch',
				options: ['explicit', 'next_major', 'next_minor', 'next_patch'],
			},
			`${file} manual publication must support established semantic version modes`,
		);
		assert.deepEqual(
			workflow.on.workflow_dispatch?.inputs?.image_tag,
			{
				description: 'Explicit image tag when version_mode=explicit',
				required: false,
				default: '',
				type: 'string',
			},
			`${file} manual publication must accept an explicit immutable tag`,
		);
		assert.deepEqual(
			workflow.on.workflow_dispatch?.inputs?.push_latest,
			{
				description: 'Also promote the image to latest',
				required: true,
				type: 'choice',
				default: 'true',
				options: ['false', 'true'],
			},
			`${file} manual publication must make latest promotion explicit`,
		);
		assert.deepEqual(
			workflow.concurrency,
			{ group: 'publish-container', 'cancel-in-progress': false },
			`${file} must serialize every automatic and manual publication`,
		);

		const prepare = workflow.jobs?.prepare;
		const publish = workflow.jobs?.publish;
		assert.ok(prepare && publish, `${file} must separate source verification from publication`);
		assert.deepEqual(prepare.permissions, { contents: 'read' }, `${file} prepare job must be read-only`);
		assert.deepEqual(
			publish.permissions,
			{ attestations: 'write', contents: 'read', 'id-token': 'write', packages: 'write' },
			`${file} publish job must use only its required permissions`,
		);
		assert.deepEqual(publish.needs, ['prepare'], `${file} publish job must depend on source verification`);
		assert.equal(
			publish.env?.SOURCE_SHA,
			'${{ needs.prepare.outputs.source_sha }}',
			`${file} publish job must consume the verified source SHA`,
		);

		for (const [jobName, job] of Object.entries({ prepare, publish })) {
			const checkouts = (job.steps ?? []).filter((step) => step.uses?.startsWith('actions/checkout@'));
			assert.equal(checkouts.length, 1, `${file} ${jobName} job must have exactly one checkout`);
			const [checkout] = checkouts;
			assert.equal(checkout.with?.ref, 'main', `${file} ${jobName} checkout must select main`);
			assert.equal(checkout.with?.['fetch-depth'], 0, `${file} ${jobName} checkout must include main history`);
			assert.equal(
				checkout.with?.['persist-credentials'],
				false,
				`${file} ${jobName} checkout must not persist credentials`,
			);
		}

		const prepareCondition = prepare.if ?? '';
		for (const invariant of [
			"github.event.workflow_run.conclusion == 'success'",
			"github.event.workflow_run.event == 'push'",
			"github.event.workflow_run.head_branch == 'main'",
			'github.event.workflow_run.head_repository.id == github.event.repository.id',
			"github.ref == 'refs/heads/main'",
		]) {
			assert.ok(prepareCondition.includes(invariant), `${file} prepare condition must enforce ${invariant}`);
		}

		for (const invariant of [
			'^[0-9a-f]{40}$',
			'trusted_main_sha="$(git rev-parse HEAD)"',
			'git merge-base --is-ancestor "${source_sha}" "${trusted_main_sha}"',
			'git merge-base --is-ancestor "${SOURCE_SHA}" "${trusted_main_sha}"',
			'git checkout --detach "${SOURCE_SHA}"',
			'actual_sha="$(git rev-parse HEAD)"',
			'name=ghcr.io/rsocko/ohm',
			'export VERSION_MODE="next_patch"',
			'sha_tag="sha-${SOURCE_SHA:0:7}"',
			'python3 .github/scripts/resolve_registry_version.py',
			'require_absent "${IMAGE}:${VERSION_TAG}"',
			'require_absent "${IMAGE}:${SHA_TAG}"',
			'docker buildx imagetools create',
			'verification_refs+=("${sha_ref}")',
			'verification_refs+=("${latest_ref}")',
			"--format '{{.Manifest.Digest}}'",
			'verify_digest "${reference}"',
			'OHM_BUILD_SHA',
			'OHM_DEPLOYMENT_REVISION',
			'--attest type=sbom',
			'--provenance=false',
		]) {
			assert.ok(source.includes(invariant), `${file} must enforce publication invariant: ${invariant}`);
		}

		const attestationSteps = (publish.steps ?? []).filter((step) => step.uses?.startsWith('actions/attest@'));
		assert.equal(attestationSteps.length, 1, `${file} publish job must have exactly one attestation`);
		assert.equal(
			attestationSteps[0].uses,
			'actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d',
			`${file} attestation must pin a default-provenance-capable actions/attest release`,
		);
		assert.deepEqual(
			attestationSteps[0].with,
			{
				'subject-name': '${{ steps.image.outputs.name }}',
				'subject-digest': '${{ steps.publish.outputs.digest }}',
				'push-to-registry': true,
			},
			`${file} attestation must use supported default provenance for the published digest`,
		);

		const loginIndex = publish.steps.findIndex((step) => step.name === 'Log in to GHCR');
		const resolveIndex = publish.steps.findIndex((step) => step.name === 'Resolve immutable publication tags');
		const buildIndex = publish.steps.findIndex((step) => step.name === 'Build and publish digest-oriented image');
		const attestIndex = publish.steps.findIndex((step) => step.name === 'Attest build provenance');
		const promoteIndex = publish.steps.findIndex((step) => step.name === 'Promote attested digest to requested tags');
		assert.ok(loginIndex >= 0 && resolveIndex > loginIndex, `${file} must resolve versions after GHCR login`);
		assert.ok(buildIndex > resolveIndex, `${file} must resolve and reserve immutable tags before building`);
		assert.ok(attestIndex > buildIndex, `${file} must attest the digest after building`);
		assert.ok(promoteIndex > attestIndex, `${file} must promote only the attested digest`);
		assert.doesNotMatch(
			source,
			/\bgit\s+fetch\b/u,
			`${file} must not fetch after checkout removes private-repository credentials`,
		);
		assert.ok(!source.includes('GITHUB_SHA'), `${file} must not build or attest the trigger-context SHA`);

		const logoutStep = (publish.steps ?? []).find((step) => step.name === 'Log out of GHCR');
		assert.ok(logoutStep, `${file} must always log out of GHCR`);
		assert.equal(logoutStep.if, '${{ always() }}', `${file} GHCR logout must run even when publication fails`);
	}

	for (const uses of collectUses(workflow)) {
		assert.equal(typeof uses, 'string', `${file} contains a non-string uses value`);
		assert.match(
			uses,
			/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/u,
			`${file} action references must use a full commit SHA`,
		);
		const action = uses.slice(0, uses.indexOf('@'));
		assert.ok(allowedActions.has(action), `${file} uses action ${action}, which is not allowlisted`);
	}
}

assert.ok(hasPullRequestWorkflow, 'At least one workflow must validate pull requests');
console.log(`Validated ${workflowFiles.length} workflow files`);
