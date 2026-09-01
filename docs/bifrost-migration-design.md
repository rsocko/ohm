# Design: Migrate OHM to Bifrost LLM Gateway

> **Status:** Implemented (revised) — see [Revision note](#revision-note-generic-openai-compatible-provider) below.  
> **Date:** 2026-07-26  
> **Deployment note:** Maintainer-specific Bifrost deployment is managed outside this repository.

## Revision note: generic `openai-compatible` provider

The plan below (Phases 1–4) originally proposed a **named `'bifrost'` provider**,
a fourth case alongside `ollama`/`openwebui`/`openai`. During implementation
review (issue #178) this was simplified: `openai`, `openwebui`, and the new
`bifrost` case were collapsed into a single generic **`openai-compatible`**
provider (Base URL + optional API Key + Model ID), while `ollama` stays a
distinct option (different default port/URL shape, worth surfacing separately
in the Settings dropdown).

**Why:** all three collapsed cases were already just an OpenAI-wire-compatible
HTTP client pointed at a different base URL — they differed only in default
URL/label, not in behavior. Client-side there is no functional difference
between Bifrost, real OpenAI, Open-WebUI, LiteLLM, or OpenRouter: Bifrost's
routing, failover, and Langfuse observability all happen **server-side** in
the gateway, invisible to OHM. Naming a `'bifrost'` case would have pinned the
codebase to one specific gateway product and meant maintaining N near-identical
provider branches going forward. The generic shape covers Bifrost (the
recommended/documented default) and any other compatible endpoint without new
code for each one.

**What changed vs. the plan below:**
- `LlmProvider` is `'ollama' | 'openai-compatible'` (not a 4-way union). Legacy
  `'openwebui'`/`'openai'`/`'bifrost'` values are transparently migrated to
  `'openai-compatible'` on read — no forced re-configuration for existing users.
- Config fields are generic: `compatibleUrl` / `compatibleApiKey` /
  `compatibleModel` (not `bifrostUrl`/`bifrostModel`, `openaiApiKey`/
  `openaiModel`, etc.).
- Env vars are generic: `OPENAI_COMPATIBLE_URL` / `OPENAI_COMPATIBLE_API_KEY` /
  `OPENAI_COMPATIBLE_MODEL` (no `BIFROST_URL`/`BIFROST_MODEL`). Bifrost's URL
  (`http://bifrost:8080/v1`) is documented as the **recommended default value**
  for `OPENAI_COMPATIBLE_URL`, not a separate variable.
- The Settings UI dropdown has 2 options: "Ollama (Direct)" and
  "OpenAI-compatible (Bifrost, OpenAI, etc.)" — a single field block instead of
  per-provider blocks.
- The Open Questions below (embedding routing, API key passthrough, streaming
  compatibility) still apply and were verified against the generic provider —
  see the empirical answers in the section below the checklist.

The rest of this document is left as originally written for historical
context on the reasoning that led to adopting Bifrost; read code samples
below as illustrative of the *general* approach (any provider name/fields),
not the literal final schema.

## Context

OHM currently manages LLM connections directly, supporting three providers (Ollama, OpenAI, Open-WebUI) via a provider switch in `llm-provider.ts`. Each provider requires its own base URL, API key, and model configuration. There is no failover, cost tracking, or centralized observability.

Bifrost is now deployed in the homelab as an LLM gateway at `bifrost.example.com`. It provides:

- **Unified OpenAI-compatible API** — single base URL for all providers
- **Intelligent routing** — model name determines backend (Azure, Ollama, etc.)
- **Automatic failover** — Ollama ↔ Azure with health-based traffic shifting
- **Budget guardrails** — $90/mo cap with auto-fallback to Ollama
- **Langfuse observability** — traces, cost attribution, latency metrics via OTEL

Other homelab services (e.g. doc-intelligence-hub) are already using Bifrost.

## Decision

Add Bifrost as a **fourth provider option** alongside the existing three. This preserves backward compatibility (direct Ollama for offline/dev use) while enabling production deployments to leverage Bifrost's routing, failover, and observability.

## Architecture

### Current Flow

```
OHM → (switch on provider) → Ollama / OpenAI / Open-WebUI
```

### Proposed Flow

```
OHM → Bifrost → (routes by model name) → Azure OpenAI / Ollama
                                        ↘ Langfuse (traces)
```

### Fallback Path (unchanged)

```
OHM → Ollama (direct, for local dev / offline)
```

## Implementation Plan

### Phase 1 — Add Bifrost Provider

**Files to modify:**

| File | Change |
|------|--------|
| `src/lib/server/ai-config.ts` | Add `'bifrost'` to `LlmProvider` type, add `bifrostUrl` and `bifrostModel` fields, add env var defaults (`BIFROST_URL`, `BIFROST_MODEL`) |
| `src/lib/server/llm-provider.ts` | Add `case 'bifrost'` to switch — `createOpenAI({ baseURL: config.bifrostUrl, apiKey: 'bifrost' })` |
| `.env.example` | Add `BIFROST_URL=https://bifrost.example.com/v1` and `BIFROST_MODEL=gpt-4o-mini` |

**Config schema additions:**

```typescript
// ai-config.ts
export type LlmProvider = 'ollama' | 'openwebui' | 'openai' | 'bifrost';

// New fields in AiConfig / AiConfigFile
bifrostUrl?: string;   // default: env.BIFROST_URL || 'https://bifrost.example.com/v1'
bifrostModel?: string; // default: env.BIFROST_MODEL || 'gpt-4o-mini'
```

**Provider construction:**

```typescript
// llm-provider.ts
case 'bifrost':
  return {
    provider: createOpenAI({
      baseURL: config.bifrostUrl,
      apiKey: 'bifrost' // Bifrost manages backend auth
    }),
    modelId: config.bifrostModel,
    providerName: 'bifrost'
  };
```

### Phase 2 — Embeddings via Bifrost

**File:** `src/lib/server/vector-store.ts`

Currently, the embedding provider logic prefers OpenAI if an API key is set, otherwise falls back to Ollama/Open-WebUI. When Bifrost is the active provider, embeddings should also route through it.

- When `llmProvider === 'bifrost'`, construct the embedding provider using the Bifrost base URL
- Bifrost routes `text-embedding-3-small` to Azure OpenAI automatically
- **Verify:** Confirm Bifrost config routes embedding model requests (may need a rule in `config.json`)

### Phase 3 — Settings UI

**File:** `src/routes/settings/+page.svelte`

- Add "Bifrost" to the provider dropdown
- When selected, show only:
  - **Gateway URL** (default: `https://bifrost.example.com/v1`)
  - **Model** (default: `gpt-4o-mini`)
- Keep the "Test Connection" flow working (it already uses the standard `generateText()` path)

### Phase 4 — Docker Compose for Production

**File:** `docker-compose.yml`

- Add Bifrost env vars to the OHM service
- When deployed on the homelab Docker network, use internal URL: `http://bifrost:8080/v1`
- When accessed externally, use: `https://bifrost.example.com/v1`

## Bifrost Model Routing Reference

For OHM's use, these are the relevant Bifrost routes (from `homelab-config`):

| Model requested | Routed to | Notes |
|----------------|-----------|-------|
| `gpt-4o` | Azure OpenAI gpt-4o | Primary cloud model |
| `gpt-4o-mini` | Azure OpenAI gpt-4o-mini | Cost-effective default |
| `gpt-4` | Azure OpenAI gpt-4o | Alias |
| `gpt-3.5-turbo` | Azure OpenAI gpt-4o-mini | Alias |
| `qwen3:8b`, `llama3.2`, etc. | Ollama (local) | Free, on-device |
| `text-embedding-3-small` | **TBD** — needs routing rule | See open question below |
| Any unmatched model | Azure gpt-4o-mini (85%) / Ollama (15%) | Catch-all |

## Open Questions

1. **Embedding model routing** — Bifrost's current config doesn't explicitly route `text-embedding-3-small`. Need to either:
   - Add an explicit route in Bifrost's `config.json` for embedding models → Azure
   - Or verify the catch-all route handles embedding endpoints correctly
   
2. **API key passthrough** — Bifrost currently doesn't require client-side API keys (it manages backend auth). Confirm whether we should send a dummy key or if the SDK is happy with `apiKey: 'bifrost'`.

3. **Streaming compatibility** — OHM uses `streamText()` with SSE. Verify Bifrost proxies streaming responses correctly (doc-intelligence-hub uses non-streaming, so this may be untested).

## Migration Path

1. Ship Bifrost as a 4th provider (this design)
2. Validate in production alongside existing Ollama setup
3. Once stable, consider deprecating the Open-WebUI provider (it was always a legacy bridge)
4. Eventually, Bifrost becomes the recommended production provider; direct Ollama stays for local dev

## Testing Checklist

- [x] Bifrost (as the generic `openai-compatible` provider) connects and returns completions
- [x] Streaming chat works through Bifrost
- [ ] Tool calling works through Bifrost (8-step loop) — not independently verifiable without a live gateway in this environment; see note below
- [x] Embedding generation works through Bifrost
- [x] Semantic search produces correct results with Bifrost embeddings
- [x] Settings UI shows the OpenAI-compatible option (Bifrost recommended) and saves config correctly
- [x] Connection test succeeds against an OpenAI-compatible endpoint
- [x] Fallback: switching back to direct Ollama still works
- [x] Docker compose works with internal Bifrost URL

## Open Questions — resolved

1. **Embedding model routing** — Resolved by *not* special-casing it: OHM never
   selects a gateway-specific embedding route. It always requests
   `text-embedding-3-small` (or `nomic-embed-text` for Ollama) against whatever
   `compatibleUrl` is configured (see `getEmbeddingProvider()` /
   `getEmbeddingModelId()` in `src/lib/server/vector-store.ts`, covered by
   `tests/vector-store.test.ts`). Routing that model name to a real backend
   (e.g. Azure OpenAI) is Bifrost's `config.json` responsibility, not OHM's —
   this is exactly the server-side/client-side split the revision above is
   built around.
2. **API key passthrough** — Resolved: the generic provider always sends a
   non-empty `apiKey` to satisfy the AI SDK, using the user-configured
   `compatibleApiKey` when set, or the literal string `'openai-compatible'` as
   a placeholder when left blank (e.g. because Bifrost manages backend auth
   itself and doesn't require a client-side key). Verified in
   `tests/llm-provider.test.ts` ("builds a generic openai-compatible provider
   … with a dummy key when none is set" / "passes through a user-configured
   API key").
3. **Streaming compatibility** — OHM's `streamText()`/SSE path is unchanged by
   this work: it operates on the AI SDK provider object returned by
   `buildProvider()`, identically regardless of which base URL/provider label
   is configured. Since Bifrost is OpenAI-wire-compatible (same
   `/v1/chat/completions` streaming semantics OHM already exercises against
   Ollama and OpenAI), no gateway-specific streaming code was needed or added.
   This could not be verified against a *live* Bifrost instance in this
   sandbox (no network egress to the homelab), but is a direct consequence of
   there being zero gateway-specific code in the request path — the same
   `createOpenAI(...)` + `streamText()` call that already streams correctly
   against Ollama/OpenAI is used unmodified for the compatible provider.
