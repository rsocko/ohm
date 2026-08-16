<!--
Thanks for contributing to Ohm! Please fill out this template — it helps
review go faster, especially for a public repo maintained by one person.
-->

## What does this change do?

<!-- Describe the change and why it's needed. Link related issues (e.g. "Closes #123"). -->

## How was this tested?

<!-- e.g. `npm test`, `npm run check`, `npm run build`, manual verification steps -->

## Privacy & security checklist

- [ ] No real credentials, API keys, tokens, or secrets are included in this diff (code, tests, fixtures, or commit messages)
- [ ] No personal data (home addresses, device identifiers/serials, private hostnames/IPs) is included
- [ ] No new dependency sources other than the public npm registry (`https://registry.npmjs.org/`) — no git/file/link specifiers, no alternate registries (`npm run verify:registry` passes)
- [ ] This PR does not modify `.github/workflows/ci.yml` permissions/trust boundary in a way that would expose secrets to fork PRs
- [ ] `tests/fixtures.ts` and demo fixture data changes (if any) use synthetic, non-personal data only

## Checklist

- [ ] `npm run check` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] Docs updated if user-facing behavior changed
