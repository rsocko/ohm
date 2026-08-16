# Contributing to Ohm

Thanks for your interest in contributing! Ohm is a personal/open-source
project (home electrical intelligence app), and outside contributions are
welcome for bug fixes, tests, docs, and well-scoped features.

## Before you start

- For anything beyond a small fix, please open an issue first to discuss the
  approach — this avoids wasted effort on changes that don't fit the
  project's direction.
- This repository does **not** include the maintainer's private deployment
  (Docker registry push, homelab runner, live Home Assistant/NocoDB/UniFi
  instances). Contributions should target the public app code, its tests,
  and public CI only. See the [README](README.md#deployment) for details.

## Development setup

```bash
npm install
cp .env.example .env   # fill in your own dev/test service endpoints, or leave blank and use DEMO_MODE=true
npm run dev
```

See the [README](README.md) for the full local setup, demo mode, and
available npm scripts.

## Before opening a PR

Run the same checks CI runs:

```bash
npm ci
npm run verify:registry   # dependency supply-chain guard
npm run check              # svelte-check type checking
npm test                   # default (deterministic) test suite
npm run build
```

Notes:

- `tests/integration/**` are **live** integration tests against a real,
  operator-configured NocoDB instance. They are excluded from `npm test` and
  CI; don't add code that depends on them passing. See `npm run test:live`
  and `tests/integration/live-mcp.test.ts` for details if you need to touch
  that suite.
- Do not add new dependency sources other than the public npm registry
  (`https://registry.npmjs.org/`) — no git/file/link dependency specifiers,
  no alternate registries. `npm run verify:registry` enforces this and will
  fail CI otherwise.
- Do not commit real credentials, tokens, or personal data (home addresses,
  device identifiers, etc.) in code, tests, fixtures, or commit messages.
  Use `.env` (git-ignored) for secrets and synthetic/example data in fixtures.

## Pull requests

- Keep PRs focused — one logical change per PR is easier to review.
- Include tests for new behavior and bug fixes where practical.
- Fill out the PR template, including the privacy/security checklist.
- Public CI runs on GitHub-hosted runners with no access to secrets or
  private services, so your PR (including from a fork) should pass all
  checks without needing anything from the maintainer.

## Code of Conduct

Participation in this project is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting security issues

Please do not file public issues for security vulnerabilities — see
[SECURITY.md](SECURITY.md).
