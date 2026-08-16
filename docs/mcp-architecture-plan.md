# Domain MCP Architecture Plan

> Last updated: 2026-07-09

## Summary of Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Deployment | Embedded in SvelteKit, exposed via HTTP | Single container, external clients connect via `https://ohm.domain/mcp` |
| Orchestration | SvelteKit is the orchestrator (Option A) | Controls confirmation flow, system prompt, avoids Open-WebUI tool inconsistencies |
| LLM Backend | Direct Ollama (or configurable) | Simpler tool-call loop, no Open-WebUI proxy issues |
| Confirmation | Reads auto-execute, writes always confirm | User never misses a mutation |
| MCP Clients | Ohm PWA (primary), Siri Shortcuts, Home Assistant | Standard HTTP/SSE transport enables all three |
| Data Layer | NocoDB now via DataProvider, SQLite migration later | Provider interface makes this transparent |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Ohm Docker Container                           │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              SvelteKit Server                             │    │
│  │                                                          │    │
│  │  ┌─────────────────────┐    ┌──────────────────────┐     │    │
│  │  │  /api/chat           │    │  /api/mcp (HTTP/SSE) │     │    │
│  │  │  (Chat orchestrator) │    │  (External clients)  │     │    │
│  │  │  • System prompt     │    │  • Siri Shortcuts    │     │    │
│  │  │  • LLM tool loop     │    │  • Home Assistant    │     │    │
│  │  │  • Confirmation UX   │    │  • Claude Desktop    │     │    │
│  │  └──────────┬───────────┘    └───────────┬──────────┘     │    │
│  │             │                            │                │    │
│  │             └────────────┬───────────────┘                │    │
│  │                          ▼                                │    │
│  │  ┌──────────────────────────────────────────────────┐     │    │
│  │  │           MCP Tool Registry                       │     │    │
│  │  │                                                   │     │    │
│  │  │  READ TOOLS (auto-execute, return data)           │     │    │
│  │  │  • what_is_on_circuit(number, panel?)             │     │    │
│  │  │  • get_room_summary(room_name)                    │     │    │
│  │  │  • get_panel_directory(panel_name)                │     │    │
│  │  │  • find_device(description, room?)                │     │    │
│  │  │  • search_electrical(query)                       │     │    │
│  │  │  • get_circuit_capacity(circuit_number)           │     │    │
│  │  │                                                   │     │    │
│  │  │  WRITE TOOLS (return confirmation payload)        │     │    │
│  │  │  • create_room(name, floor, home)                 │     │    │
│  │  │  • add_load(name, type, room, circuit?)           │     │    │
│  │  │  • add_receptacle(name, type, room, circuit?)     │     │    │
│  │  │  • move_device_to_circuit(device, circuit)        │     │    │
│  │  │  • update_record(table, id, fields)               │     │    │
│  │  │  • link_to_circuit(device_id, circuit_number)     │     │    │
│  │  │                                                   │     │    │
│  │  │  SMART TOOLS (domain logic + validation)          │     │    │
│  │  │  • create_device(description, room, circuit?)     │     │    │
│  │  │    → uses vocabulary to infer Load vs Receptacle  │     │    │
│  │  │  • suggest_circuit(amps, location)                │     │    │
│  │  │  • validate_capacity(circuit, additional_amps)    │     │    │
│  │  └──────────────────────┬───────────────────────────┘     │    │
│  │                         │                                 │    │
│  │                         ▼                                 │    │
│  │  ┌──────────────────────────────────────────────────┐     │    │
│  │  │           DataProvider Interface                   │     │    │
│  │  │   (NocoDB now → SQLite later, transparent)        │     │    │
│  │  └──────────────────────────────────────────────────┘     │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  ┌──────────────┐             ┌──────────────────┐
  │   Ollama     │             │     NocoDB       │
  │   (LLM)     │             │   (data store)   │
  └──────────────┘             └──────────────────┘
```

---

## Tool Surface Design

### Design Principles

1. **Intent-level, not CRUD-level** — tools express what the user wants, not DB operations
2. **Vocabulary-aware** — tools accept natural language descriptions and resolve internally
3. **Self-documenting** — tool names teach the LLM what's possible
4. **Minimal tool count** — fewer tools = less AI confusion. Target: ~12 tools total
5. **Consistent return shapes** — reads return data, writes return confirmations

### Read Tools (auto-execute)

| Tool | Description | Returns |
|------|-------------|---------|
| `what_is_on_circuit` | Everything on a circuit: loads, receptacles, capacity | `{ circuit, loads[], receptacles[], capacity }` |
| `get_room_summary` | All electrical info for a room | `{ room, circuits[], loads[], receptacles[] }` |
| `get_panel_directory` | Full breaker schedule for a panel | `{ panel, circuits[] with load summaries }` |
| `find_device` | Find loads/receptacles by description | `{ matches[] with scores }` |
| `search_electrical` | Free-text search across all tables | `{ results[] }` |
| `get_circuit_capacity` | Amperage analysis for a circuit | `{ rated, estimated_draw, utilization_pct, headroom }` |

### Write Tools (always return confirmation)

| Tool | Description | Confirmation shows |
|------|-------------|-------------------|
| `create_room` | Create a new room/area linked to home | Room name, floor, home link |
| `create_device` | **Smart tool**: infers Load vs Receptacle from description | Inferred type, table, room link, circuit link |
| `add_load` | Explicit load creation | Name, type, wattage, room, circuit |
| `add_receptacle` | Explicit receptacle creation | Name, type, gang, direction, room, circuit |
| `move_device_to_circuit` | Reassign a load/receptacle to different circuit | Before → after circuit |
| `link_to_room` | Link an existing device to a room | Device name → room name |
| `update_field` | Update any field on any record | Record, field, old value → new value |

### The `create_device` Smart Tool (Key Innovation)

This is the disambiguation resolver. When a user says "add a dimmer to the kitchen":

```
Input:  { description: "dimmer", room: "Kitchen", circuit: 7 }
                    ↓
         vocabulary.inferEntityFromDescription("dimmer")
                    ↓
         { table: "Receptacle", typeValue: "Dimmer Switch" }
                    ↓
Output: confirmation payload showing:
        CREATE Receptacle "Kitchen Dimmer Switch"
        • Type: Dimmer Switch
        • Room: Kitchen
        • Circuit: 7
```

If the vocabulary can't resolve (returns null), the tool asks the AI to clarify, which then asks the user.

---

## Confirmation Flow Redesign

### Current (Complex, Fragile)

```
AI calls propose_batch → tool returns data → closure captures → 
textStream finishes → markers appended → client parses markers → 
sets pendingBatch → renders BatchConfirmation → user clicks → 
separate __CONFIRM_BATCH__ POST → execute
```

### New (Simple, Reliable)

```
AI calls write tool → tool returns { confirmation: true, payload } →
orchestrator detects confirmation → streams text + appends structured JSON →
client renders ConfirmationCard → user clicks → 
POST /api/mcp/execute with payload → execute → return result
```

Key simplifications:
1. **No more `propose_batch` meta-tool** — each write tool IS the proposal
2. **No more closure hacking** — tool results are structured, orchestrator handles them
3. **No more stream markers** — use a proper structured response format (JSON after text, or SSE events)
4. **Single execute endpoint** — `/api/mcp/execute` handles all confirmed operations
5. **Payload is self-contained** — contains everything needed to execute (no state dependency)

### Confirmation Payload Shape

```typescript
interface ConfirmationPayload {
  id: string;                    // Unique ID for this proposal
  tool: string;                  // Which tool generated it
  summary: string;               // One-line description
  operations: Operation[];       // What will happen
  execute: ExecuteRequest;       // Exact request to send to /api/mcp/execute
}

interface Operation {
  action: 'create' | 'update' | 'link' | 'delete';
  table: string;
  label: string;
  details: Record<string, unknown>;
}

interface ExecuteRequest {
  tool: string;
  args: Record<string, unknown>;  // Same args the tool received
  confirmed: true;
}
```

### Client-Side Changes

The `BatchConfirmation.svelte` component stays mostly the same but receives data from the new format. The `chatState.pendingBatch` becomes `chatState.pendingConfirmation` (singular, since each write tool produces one confirmation).

---

## Response Format: Replacing Stream Markers

### Option A: Structured SSE (Recommended)

Instead of raw text stream with hidden markers, use SSE events:

```
event: text
data: Here's what I'll do for you...

event: text  
data: I'll create "Jordan's Room" on the 2nd floor.

event: confirmation
data: {"id":"conf_abc","tool":"create_room","summary":"Create Jordan's Room","operations":[...],"execute":{...}}

event: done
data: {}
```

Client parses events cleanly — no regex, no marker stripping.

### Option B: JSON envelope after text (Simpler migration)

Keep current text streaming, but use a cleaner delimiter:

```
<text stream>
\n\n---OHM_RESPONSE_META---\n
{"confirmations":[...],"deepLinks":[...],"dataCards":[...]}
```

### Recommendation: Option A (SSE)

It's cleaner, supports multiple data types in one stream (text + confirmations + data cards), and every browser handles SSE natively. The AI SDK already supports SSE on the server side.

---

## LLM Integration Changes

### Current: Open-WebUI Proxy

```
SvelteKit → Open-WebUI /api/chat/completions → Ollama → response with tool calls
```

Problems:
- Tool calling support varies by Open-WebUI version and model
- Extra network hop
- Open-WebUI may modify/strip tool results

### New: Direct Ollama (via AI SDK)

```
SvelteKit → Ollama http://localhost:11434 → response with tool calls
```

```typescript
import { createOllama } from 'ollama-ai-provider'; // or use createOpenAI with Ollama's OpenAI-compat endpoint

const provider = createOpenAI({
  baseURL: 'http://ollama:11434/v1',  // Ollama's OpenAI-compatible endpoint
  apiKey: 'ollama',  // Ollama doesn't need a real key
});
```

Keep configurable via env:
```
LLM_PROVIDER=ollama          # or "openwebui" or "openai"
LLM_BASE_URL=http://ollama:11434/v1
LLM_MODEL=qwen3:14b
LLM_API_KEY=ollama
```

---

## External Client Support (Siri, Home Assistant)

### `/api/mcp` Endpoint

Expose the MCP tool registry via standard MCP HTTP transport (Streamable HTTP, the current MCP spec):

```
POST /api/mcp
Content-Type: application/json

{ "method": "tools/list" }     → returns available tools
{ "method": "tools/call", "params": { "name": "get_room_summary", "arguments": {...} } }
```

### Siri Shortcuts Integration

Siri Shortcuts can call HTTP endpoints directly:
1. User triggers shortcut: "Hey Siri, what's on circuit 7?"
2. Shortcut sends POST to `https://ohm.domain/api/mcp` with `tools/call`
3. Response is spoken back via Shortcuts text-to-speech

For write operations via Siri:
1. Shortcut calls the write tool
2. Gets confirmation payload back
3. Shows a confirmation dialog in Shortcuts
4. On confirm, calls `/api/mcp/execute`

### Home Assistant Integration

HA can call REST endpoints via `rest_command` or custom components:
```yaml
rest_command:
  ohm_query:
    url: "https://ohm.domain/api/mcp"
    method: POST
    content_type: "application/json"
    payload: '{"method":"tools/call","params":{"name":"{{ tool }}","arguments":{{ args | tojson }}}}'
```

Or build a custom HA integration that registers as a conversation agent — user talks to HA voice, it routes electrical questions to Ohm's MCP.

---

## File Structure

```
src/lib/server/
├── db/
│   ├── index.ts              ← barrel export (existing)
│   ├── models.ts             ← domain types (existing)
│   ├── provider.ts           ← DataProvider interface (existing)
│   ├── nocodb-provider.ts    ← NocoDB implementation (existing)
│   └── vocabulary.ts         ← entity disambiguation (existing)
├── mcp/
│   ├── index.ts              ← tool registry + execute dispatcher
│   ├── types.ts              ← ConfirmationPayload, ExecuteRequest, etc.
│   ├── tools/
│   │   ├── read.ts           ← what_is_on_circuit, get_room_summary, etc.
│   │   ├── write.ts          ← create_room, create_device, add_load, etc.
│   │   └── smart.ts          ← suggest_circuit, validate_capacity
│   └── transport.ts          ← MCP HTTP/SSE transport handler
├── nocodb.ts                  ← raw NocoDB client (kept, used by provider)
└── ai-config.ts              ← LLM configuration
src/routes/
├── api/
│   ├── chat/+server.ts       ← simplified: LLM orchestrator + SSE response
│   └── mcp/
│       ├── +server.ts        ← MCP HTTP transport (tools/list, tools/call)
│       └── execute/+server.ts ← confirmed operation execution
```

---

## What Changes vs. What We Keep

### Keep (no changes needed)
- `db/models.ts` — domain types are correct
- `db/provider.ts` — interface is correct
- `db/nocodb-provider.ts` — implementation is correct
- `db/vocabulary.ts` — disambiguation logic is correct
- `BatchConfirmation.svelte` — UI component works, just needs new data source
- `VoiceInput.svelte` — voice input is independent of backend
- `fuzzy-match.ts` — still used by `find_device` tool
- Tests — all still valid

### Modify
- `+server.ts` (chat) — strip all tool definitions, replace with MCP tool calls + SSE response format
- `chat.svelte.ts` — parse SSE events instead of raw text + markers
- `MessageBubble.svelte` — minor: confirmation data comes from SSE event not message property

### Remove (after migration)
- `propose_batch` tool definition
- `propose_update` tool definition  
- `__CONFIRM_BATCH__` handler
- `__CONFIRM_ACTION__` handler
- Stream marker parsing (closure-based confirmations)
- `fullStream` / `textStream` hacking

### Create (new)
- `mcp/` directory with tool registry
- `/api/mcp/` route for external clients
- `/api/mcp/execute/` route for confirmed operations
- SSE response formatting in chat endpoint

---

## Implementation Order

### Step 1: MCP Tool Registry (foundation)
Build `src/lib/server/mcp/` with tool definitions that use the DataProvider.
Each tool is a pure function: args in → result out.
Write tools return `ConfirmationPayload`.

### Step 2: Wire Chat Endpoint
Replace the inline tool definitions in `+server.ts` with calls to the MCP registry.
Switch from raw text stream to SSE format.
Keep LLM integration (switch to direct Ollama later).

### Step 3: Client SSE Parsing
Update `chat.svelte.ts` to parse SSE events.
Confirmation payloads render the existing BatchConfirmation UI.
Execute endpoint replaces `__CONFIRM_BATCH__`.

### Step 4: External Transport
Add `/api/mcp` route with standard MCP protocol.
Test with a simple curl client.
Document for Siri Shortcuts integration.

### Step 5: LLM Backend Switch
Add direct Ollama support via env config.
Test tool calling with your models directly.
Keep Open-WebUI as a fallback option.

---

## Open Questions

1. **Auth for external MCP endpoint** — API key? Same Docker network only? Both?
2. **Which Ollama model for tool calling?** — Qwen3, Llama 3.1, Mistral? Need to test which handles structured tool output best.
3. **Should Siri be read-only initially?** — Writes via voice shortcut need careful confirmation UX.
4. **Rate limiting** — Do we need it for the MCP endpoint?

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Ollama model doesn't tool-call well | Keep Open-WebUI as fallback; test multiple models |
| SSE parsing more complex than markers | Use established EventSource API; simpler long-term |
| External MCP endpoint security | API key auth + optional IP allowlist |
| Breaking existing chat UX during migration | Build new path alongside old, switch over atomically |
| NocoDB link issues persist | DataProvider encapsulates; SQLite migration eliminates |
