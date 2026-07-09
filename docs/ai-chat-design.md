# AI Chat Feature — Design Document

## Overview

Enhanced AI Chat for the Electrical Config PWA that replaces the basic one-shot Q&A with:
- **Streaming responses** via Server-Sent Events
- **Tool calling** for real NocoDB data queries and updates
- **Rich message types** (data cards, action confirmations, deep links)
- **Conversation context** (knows which page/panel/room user is viewing)
- **Message persistence** (localStorage with 200-message cap)
- **Action confirmation flow** (never auto-mutates data)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser (SvelteKit Client)                             │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ChatPanel.svelte (bottom sheet / side panel)    │    │
│  │  ├─ MessageBubble (text + deep links)           │    │
│  │  ├─ DataCard (structured key-value)             │    │
│  │  ├─ ActionConfirmation (diff + confirm/cancel)  │    │
│  │  ├─ SuggestionChips (quick prompts)             │    │
│  │  └─ TypingIndicator (bounce dots)              │    │
│  └────────────────────┬────────────────────────────┘    │
│                       │ POST /api/chat (SSE stream)     │
└───────────────────────┼─────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  SvelteKit Server (/api/chat/+server.ts)                │
│  ┌──────────────────┐  ┌────────────────────────────┐   │
│  │ System Prompt +   │  │ Tool Loop (max 5 iters)    │   │
│  │ Context Injection │  │  ├─ query_electrical_data  │   │
│  └────────┬──────────┘  │  ├─ search_all_tables     │   │
│           │             │  └─ propose_update         │   │
│           ▼             └───────────┬────────────────┘   │
│  ┌──────────────────┐              ▼                    │
│  │ Open-WebUI API   │    ┌──────────────────┐           │
│  │ (chat/completions│    │ NocoDB v3 API    │           │
│  │  with tools)     │    │ (existing client)│           │
│  └──────────────────┘    └──────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

## UX Design

### Layout (unchanged from existing bottom sheet)

| Viewport | Behavior |
|----------|----------|
| Mobile | Bottom sheet (70vh), swipe-down to dismiss |
| Desktop (≥768px) | Side panel (400px), fixed right |

### Interaction Flow

1. User taps FAB (bottom-right, above nav bar)
2. Chat opens as bottom sheet (existing pattern)
3. User types or taps suggestion chip
4. Message sent → typing indicator → streamed response
5. If response includes data card → rendered inline
6. If AI proposes update → confirmation buttons appear
7. User confirms → batch update → success message

### Message Types

| Type | Visual |
|------|--------|
| Text | Simple bubble (user=blue, AI=slate-700) |
| Deep Link | Blue underlined text with open-in-new icon |
| Data Card | Blue-tinted card with key-value rows |
| Action Confirmation | Card with change list + Confirm/Cancel buttons |
| Error | Red-tinted bubble with alert icon |

## System Prompt

```
You are an electrical configuration assistant for the project owner's homes.
You have access to NocoDB tables: Areas, Panels, Circuits, Receptacles, Loads.

Rules:
- Be specific with circuit numbers and panel locations
- If ambiguous, list matches and ask for clarification
- For updates: ALWAYS use propose_update tool, never modify directly
- Include [link:/route]text[/link] markers for navigable entities
- Keep responses concise for mobile screens
```

## Tool Definitions

### query_electrical_data
Query records from a specific table with optional text search.
- **table** (required): Area | Panel | Circuit | Receptacle | Load
- **search_text**: Free text to filter by
- **limit**: Max results (default 25)

### search_all_tables
Search across all tables when unsure where data lives.
- **query** (required): Search term

### propose_update
Generate a confirmation request (never auto-executes).
- **table** (required): Which table
- **updates**: Array of `{recordId, label, field, oldValue, newValue}`

## State Management

Uses Svelte 5 `$state` rune (matches existing `data.svelte.ts` pattern):

```typescript
export const chatState = $state({
  messages: ChatMessage[],
  isLoading: boolean,
  isOpen: boolean,
  streamingContent: string,
  pendingAction: ActionConfirmationContent | null,
  context: ChatContext
});
```

### Persistence
- Messages: localStorage (`electrical-ai-chat-messages`, 200 cap)
- Context: reactive, updated from page navigation

## Streaming Protocol (SSE)

```
data: {"type":"text","content":"The kitchen"}
data: {"type":"text","content":" is on circuit 9"}
data: {"type":"rich","contentType":"data-card","dataCard":{...}}
data: {"type":"rich","contentType":"action-confirmation","actionConfirmation":{...}}
data: {"type":"error","error":"Connection timeout"}
data: {"type":"done"}
```

### Why SSE over WebSocket?
- Simpler (HTTP-native, works through Traefik proxy)
- Unidirectional is sufficient
- Auto-reconnect built into spec
- Keeps existing `/api/ask` as simple JSON endpoint for Siri Shortcuts

## Deep Links

AI responses can include navigation markers:
- `[link:/panels?panel=123]Main Panel[/link]`
- `[link:/rooms?area=456]Kitchen[/link]`

Rendered as inline blue links with an open-in-new icon. Clicking navigates via SvelteKit.

## Backwards Compatibility

- **`/api/ask`** endpoint preserved unchanged (used by Siri Shortcuts)
- **`ChatPanel.svelte`** in same location (drop-in replacement)
- **No layout changes** needed (already imported in pages that use it)

## File Structure

```
src/
├── lib/
│   ├── components/
│   │   ├── ChatPanel.svelte          ← REPLACED (enhanced)
│   │   └── chat/
│   │       ├── MessageBubble.svelte   ← NEW
│   │       ├── DataCard.svelte        ← NEW
│   │       ├── ActionConfirmation.svelte ← NEW
│   │       ├── SuggestionChips.svelte ← NEW
│   │       └── TypingIndicator.svelte ← NEW
│   ├── stores/
│   │   └── chat.svelte.ts            ← NEW
│   └── types/
│       └── chat.ts                    ← NEW
├── routes/
│   └── api/
│       ├── ask/+server.ts            (unchanged)
│       └── chat/+server.ts           ← NEW (streaming)
```

## Future Roadmap

### Semantic Search with Embeddings

**Status:** Planned (not yet implemented)

Currently both `/search` and `/chat` use plain NocoDB text matching. A future enhancement would add vector embeddings for semantic search:

**Approach:**
- Embed circuit descriptions, area names, load details, and panel info into a vector store
- On search query, compute embedding and find nearest neighbors (cosine similarity)
- Benefits: "things that use a lot of power" would match high-wattage loads even without exact keyword match
- Could enhance both the search page results AND the AI chat's tool-call context

**Considerations:**
- ~200 total records (57 circuits, 40 areas, loads, receptacles) — small enough for in-memory vector search (no external DB needed)
- Could use OpenAI `text-embedding-3-small` via the existing Open-WebUI proxy
- Re-index on NocoDB data changes (webhook or periodic refresh)
- Hybrid approach: combine text match score + semantic score for ranked results

**Value:**
- Natural language search without AI latency (embeddings are instant lookup)
- Better context retrieval for AI chat tool calls
- Fuzzy matching: "master bedroom outlets" finds "Primary Bedroom" receptacles
