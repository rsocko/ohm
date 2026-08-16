# Ω Ohm

**AI-powered home electrical intelligence.**

Know your home, circuit by circuit. Ohm gives you instant answers about your electrical system — which circuit powers the kitchen island, what's drawing 800W right now, and whether your solar is covering it.

## What it does

- **Circuit topology** — Browse panels, circuits, rooms, outlets, and loads
- **Energy monitoring** — Live power consumption and solar production via Home Assistant
- **AI assistant** — Natural language queries: "Ask Ohm which circuit the kitchen is on"
- **Multi-home support** — Manage multiple properties from one interface
- **Device discovery** — Auto-detect UniFi network devices per home

## Stack

- **SvelteKit** — Full-stack framework (SSR + SPA)
- **Tailwind CSS** — Dark-first, mobile-first UI
- **NocoDB** — Electrical topology data store
- **Home Assistant** — Energy sensors (Emporia Vue, Enphase Solar)
- **Vercel AI SDK v7** — Streaming AI chat with tool calling
- **Open WebUI** → Azure OpenAI — LLM provider chain

## Quick start

Requires [Node.js](https://nodejs.org/) 22+ and npm.

```bash
git clone https://github.com/rsocko/ohm.git
cd ohm
npm install
cp .env.example .env   # see "Configuration" below
npm run dev
```

Then open the URL printed by Vite (default `http://localhost:5173`).

### Demo mode (no external services required)

Ohm normally talks to a NocoDB instance, Home Assistant, and optionally
UniFi/an LLM provider. To explore the app without configuring any of that,
run it in demo mode, which serves synthetic fixture data instead:

```bash
npm run dev:demo
```

This is equivalent to setting `DEMO_MODE=true` in your `.env` (see
`.env.demo`).

### Configuration (optional integrations)

Copy `.env.example` to `.env` and fill in only what you need — every
integration is optional and the app degrades gracefully (or you can just use
demo mode). See the comments in `.env.example` for each variable:

- **NocoDB** — the electrical topology data store (panels/circuits/areas/loads)
- **LLM provider** — `LLM_PROVIDER=ollama|openwebui|openai`, for the AI chat assistant
- **Home Assistant** — energy/solar sensor data
- **UniFi Network** — device discovery
- **Utility rate** — used for cost estimates in the UI

None of these values are required to build, type-check, or run the default
test suite.

## Development

```bash
npm run check   # svelte-check (TypeScript + Svelte diagnostics)
npm test        # vitest — deterministic unit/integration-against-fixtures suite
npm run build   # production build (adapter-node)
npm run preview # preview the production build locally
```

`npm run verify:registry` runs the dependency supply-chain guard (see
"Continuous integration" below); it's a CI safeguard, not a prerequisite for
local dev.

A separate `tests/integration/` suite (`npm run test:live`) exercises a real,
operator-configured NocoDB instance with live credentials. It is **not**
part of `npm test` or CI — it's for maintainers with access to that
instance only.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to
`main` and every pull request (including from forks), entirely on
GitHub-hosted runners:

1. `npm run verify:registry` — fail the build if `package.json` or
   `package-lock.json` reference anything other than
   `https://registry.npmjs.org/` (no private feeds, no git/file/link/workspace
   dependency sources)
2. `npm ci` — install dependencies strictly from the public npm registry
3. `npm run check` — type checking
4. `npm test` — the deterministic default test suite
5. `npm run build` — production build
6. `docker build .` — verify the public container build

The workflow requests only `contents: read` permission, references no
secrets, and never runs on a self-hosted runner — a pull request from a fork
can't reach anything private and doesn't need any maintainer-provided
configuration to pass.

## Deployment

This repository does not include the maintainer's private build/push/deploy
pipeline, container registry, or hosting configuration — that lives outside
this public repo. `package.json` is marked `"private": true` to prevent
accidental publication to the npm registry. If you want to run your own
instance, `npm run build` produces a standard SvelteKit `adapter-node`
build (see `Dockerfile` for one example of containerizing it) that you can
deploy however you like.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, coding guidelines,
and what to check before opening a PR. Please review our
[Code of Conduct](CODE_OF_CONDUCT.md). Security issues should be reported
privately — see [SECURITY.md](SECURITY.md).

## Brand

**Name:** Ohm (Ω) — the SI unit of resistance. Also sounds like "home."

**Personality:** Proactive, friendly, intelligent. Surfaces insights before you ask.

**Colors:** Electric Indigo (`#6366F1`) for AI/intelligence, Amber (`#F5A623`) for energy data, Cyan (`#22D3EE`) for solar/live streams.

## License

Originally built for personal use; now open for public contributions under
the terms of the [Apache License 2.0](LICENSE).
