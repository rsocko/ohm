# Design: Migrate OHM to Bifrost LLM Gateway

> **Status:** Proposed  
> **Date:** 2026-07-26  
> **Deployment note:** Maintainer-specific Bifrost deployment is managed outside this repository.

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

- [ ] Bifrost provider connects and returns completions
- [ ] Streaming chat works through Bifrost
- [ ] Tool calling works through Bifrost (8-step loop)
- [ ] Embedding generation works through Bifrost
- [ ] Semantic search produces correct results with Bifrost embeddings
- [ ] Settings UI shows Bifrost option and saves config correctly
- [ ] Connection test succeeds with Bifrost
- [ ] Fallback: switching back to direct Ollama still works
- [ ] Docker compose works with internal Bifrost URL
