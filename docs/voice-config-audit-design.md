# Voice-Enabled Configuration & Audit — Design Document

## Overview

Extend the Ask Ohm AI chat to support **voice-driven electrical configuration and auditing** — allowing users to walk around their home with a phone/tablet and create, modify, or verify rooms, loads, receptacles, and circuit assignments using natural speech.

### Goals

1. **Voice Input** — Browser-native speech-to-text with mic button in chat UI
2. **Creation Tools** — AI can create Areas, Loads, Receptacles (not just query/update)
3. **Batch Confirmation** — Table-based UI showing grouped proposed changes before commit
4. **Complex Sentence Parsing** — Single utterance → multiple table operations
5. **Disambiguation** — Fuzzy-match existing records, ask for clarification or show best-guess
6. **Audit Mode** — Verify existing data by describing what's in a room; AI confirms or proposes corrections

### Non-Goals (Future Phases)

- Whisper API backend STT (Phase 2 — better accuracy)
- Voice OUT / TTS responses (Phase 2 — browser `SpeechSynthesis` for short confirmations; toggle-able "hands-free mode"; skip reading data cards/tables aloud)
- Offline/queued commands
- Photo/OCR panel scanning
- Undo/rollback system
- AR overlay mode

---

## Architecture

### Current Architecture (unchanged)

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (SvelteKit Client)                                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ ChatPanel / Full-screen Chat                          │  │
│  │  ├─ MessageBubble (text + deep links)                 │  │
│  │  ├─ DataCard (structured key-value)                   │  │
│  │  ├─ ActionConfirmation (diff + confirm/cancel)        │  │
│  │  ├─ BatchConfirmation ← NEW                          │  │
│  │  ├─ VoiceInput ← NEW                                 │  │
│  │  └─ SuggestionChips                                   │  │
│  └────────────────────┬──────────────────────────────────┘  │
│                       │ POST /api/chat (SSE stream)         │
└───────────────────────┼─────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  SvelteKit Server (/api/chat/+server.ts)                    │
│  ┌──────────────────┐  ┌────────────────────────────────┐   │
│  │ System Prompt +   │  │ Tool Loop (max 8 iters)        │   │
│  │ Context Injection │  │  ├─ query_electrical_data      │   │
│  │ + Voice Mode flag │  │  ├─ search_all_tables          │   │
│  └────────┬──────────┘  │  ├─ propose_update             │   │
│           │             │  ├─ create_records ← NEW       │   │
│           ▼             │  ├─ assign_circuit ← NEW       │   │
│  ┌──────────────────┐   │  └─ propose_batch ← NEW       │   │
│  │ Open-WebUI API   │   └───────────┬────────────────────┘   │
│  │ (chat/completions│               ▼                        │
│  │  with tools)     │     ┌──────────────────┐               │
│  └──────────────────┘     │ NocoDB API       │               │
│                           │ (createRecord,   │               │
│                           │  updateRecord,   │               │
│                           │  replaceLinks)   │               │
│                           └──────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

### Key Principle: No New Infrastructure

All new tools are defined in the existing SvelteKit `/api/chat/+server.ts` endpoint. Open-WebUI remains a passthrough proxy. No MCP server, no new services.

---

## Voice Input

### Technology: Web Speech API

The [SpeechRecognition API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) is available in Chrome, Edge, and Safari — covering all target mobile/tablet browsers.

### Component: `VoiceInput.svelte`

```
┌─────────────────────────────────────────────┐
│  [text input field............] [🎤] [Send]  │
│                                              │
│  When mic active:                            │
│  ┌─────────────────────────────────────┐     │
│  │  🔴 Listening...  [interim text...]  │     │
│  │  ─────── waveform animation ──────── │     │
│  │  [Done] [Cancel]                     │     │
│  └─────────────────────────────────────┘     │
└─────────────────────────────────────────────┘
```

### Behavior

| Feature | Implementation |
|---------|---------------|
| Activation | Tap mic button (replaces send button while empty) |
| Feedback | Pulsing red dot + interim transcription shown live |
| End detection | `SpeechRecognition.continuous = true` with 2s silence timeout |
| Submit | Auto-submits on silence OR tap "Done" |
| Cancel | Tap "Cancel" or swipe away |
| Fallback | If `SpeechRecognition` unavailable, hide mic button entirely |
| Language | `lang = 'en-US'` |

### Implementation Notes

```typescript
// Feature detection
const speechSupported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;

// Configuration
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
recognition.continuous = true;        // Don't stop after first sentence
recognition.interimResults = true;    // Show live transcription
recognition.lang = 'en-US';
recognition.maxAlternatives = 1;

// Silence detection: stop after 2s of no new results
let silenceTimer: number;
recognition.onresult = (event) => {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => recognition.stop(), 2000);
  // Update interim text display...
};
```

### Future Phase: Whisper Enhancement

When browser STT accuracy is insufficient (technical terms, electrical jargon):
- Record audio via MediaRecorder API
- POST to `/api/voice/transcribe` → proxy to Open-WebUI Whisper endpoint
- Higher accuracy for terms like "GFCI", "AFCI", "20-amp", "14/2 Romex"

---

## New AI Tools

### 1. `create_records`

Creates one or more records across any table. Returns the created record IDs for linking.

```typescript
create_records: tool({
  description: 'Create new records in the electrical database. Use for adding new rooms, loads, receptacles. Always propose via propose_batch first unless creating a single simple record.',
  inputSchema: z.object({
    operations: z.array(z.object({
      table: z.enum(['Area', 'Panel', 'Circuit', 'Receptacle', 'Load']),
      fields: z.record(z.unknown()).describe('Field values for the new record'),
      tempId: z.string().optional().describe('Temporary ID for referencing in subsequent link operations')
    }))
  }),
  execute: async ({ operations }) => {
    const results = [];
    for (const op of operations) {
      const tableInfo = await getTableByName(op.table);
      if (!tableInfo) { results.push({ error: `Table ${op.table} not found` }); continue; }
      const record = await createRecord(tableInfo.id, op.fields);
      results.push({ tempId: op.tempId, table: op.table, recordId: record.id, fields: record.fields });
    }
    return { created: results };
  }
})
```

### 2. `assign_circuit`

Bulk-assigns loads and/or receptacles to a circuit. Handles the NocoDB link relationships.

```typescript
assign_circuit: tool({
  description: 'Assign loads and/or receptacles to a circuit. Use when user says things like "circuit 3 controls all lights in the kitchen".',
  inputSchema: z.object({
    circuit_search: z.string().describe('Circuit identifier (number or description)'),
    area_search: z.string().optional().describe('Area/room to filter by'),
    load_names: z.array(z.string()).optional().describe('Specific load names to assign'),
    receptacle_names: z.array(z.string()).optional().describe('Specific receptacle names to assign'),
    assign_all_in_area: z.boolean().optional().describe('If true, assign ALL loads+receptacles in the specified area')
  }),
  execute: async ({ circuit_search, area_search, load_names, receptacle_names, assign_all_in_area }) => {
    // 1. Find the circuit record
    // 2. Find matching loads/receptacles (by name or by area)
    // 3. Return proposed assignments for confirmation
    return { status: 'confirmation_required', /* ... */ };
  }
})
```

### 3. `propose_batch`

Extended version of `propose_update` that handles creates, updates, links, and deletions in one grouped confirmation.

```typescript
propose_batch: tool({
  description: 'Propose a batch of changes (creates, updates, link assignments) for user confirmation. ALWAYS use this for multi-step operations. The UI will show a table of all proposed changes.',
  inputSchema: z.object({
    summary: z.string().describe('One-line description of what this batch does'),
    operations: z.array(z.object({
      action: z.enum(['create', 'update', 'link', 'unlink']),
      table: z.enum(['Area', 'Panel', 'Circuit', 'Receptacle', 'Load']),
      label: z.string().describe('Human-readable description of this operation'),
      fields: z.record(z.unknown()).optional().describe('Fields for create/update'),
      recordId: z.string().optional().describe('Record ID for update/link operations'),
      linkTarget: z.object({
        table: z.string(),
        recordId: z.string()
      }).optional().describe('Target for link operations')
    }))
  }),
  execute: async ({ summary, operations }) => {
    return {
      status: 'batch_confirmation_required',
      summary,
      operations
    };
  }
})
```

### System Prompt Additions

```
Additional capabilities (voice/config mode):
- You can CREATE new records (areas, loads, receptacles) — always propose first
- You can ASSIGN circuits in bulk — "circuit 3 controls all lights in kitchen"
- You can handle COMPLEX sentences — parse multiple operations from one utterance
- When creating loads, infer Device Type from context (e.g., "ceiling lights" → type "Light")
- Default Fixture_Count to 1 unless user specifies (e.g., "4 recessed lights" → Fixture_Count: 4)
- For receptacles, infer type from context (e.g., "dimmer" → "Dimmer Switch", "outlet" → "Outlet")
- Auto-generate names following pattern: "{Area Name} {Description}" unless user gives explicit name

Disambiguation rules:
- If user mentions a name that partially matches existing records, list top 3 matches and ask
- If only one close match exists (>80% similarity), propose it as best guess with confirmation
- For circuit assignment without explicit circuit number, ASK which circuit
- Loads and receptacles CAN exist without a circuit — don't force assignment

Voice-specific behavior:
- Expect informal/conversational input — "there's 4 recessed cans on circuit 7" is valid
- Parse quantities: "4 recessed lights" → one Load with Fixture_Count=4, not 4 separate loads
- Parse placement: "north wall" → Loc.Direction = "N"
- Parse multi-gang: "3-gang box with a dimmer, switch, and outlet" → 3 receptacles with same Loc.Rec.Index
- If unsure about any detail, propose best guess AND note what you assumed
```

---

## Batch Confirmation UI

### New Component: `BatchConfirmation.svelte`

Replaces the single-change `ActionConfirmation` when multiple operations are proposed.

### Layout (Mobile-First Table)

See `docs/mockups/voice-config-batch-confirmation.html` for interactive mockup.

```
┌─────────────────────────────────────────────────┐
│  📋 Adding 4 items to Sam's Office             │
├─────────────────────────────────────────────────┤
│  Action  │ Type        │ Name           │ Details│
│──────────┼─────────────┼────────────────┼────────│
│ ＋Create │ Load        │ Ceiling Lights │ Qty: 4 │
│ ＋Create │ Receptacle  │ N-Wall Dimmer  │ Dimmer │
│ ＋Create │ Receptacle  │ Door Switch    │ On/Off │
│  🔗Link  │ Circuit 7   │ → All above    │        │
├─────────────────────────────────────────────────┤
│  [✓ Confirm All]              [✕ Cancel]         │
└─────────────────────────────────────────────────┘
```

### Responsive Behavior

| Viewport | Layout |
|----------|--------|
| Phone (<640px) | Stacked cards (no table — each operation as a mini-card) |
| Tablet (640-1024px) | Compact table as shown above |
| Desktop (>1024px) | Full table with all columns visible |

### Interaction

- **Confirm All** — Executes entire batch sequentially (creates first, then links)
- **Cancel** — Discards all; AI asks what to change
- **Individual row tap** (future) — Could allow editing before confirm
- **Voice confirm/modify** — User can say "confirm all", "remove the second one", "change circuit 7 to 3", etc. The AI interprets these as modifications to the pending batch since it has full conversation context. No special wiring needed — voice is just text input to the same chat.

> **Design note:** Tap buttons are the _fast path_ (one tap, instant). Voice is the _hands-free path_ (speak, wait for AI parsing). Both work for confirms, cancels, disambiguation responses, and partial edits. The architecture gives us this for free.

---

## Complex Sentence Parsing

### Example Utterances → Operations

| Voice Input | Parsed Operations |
|---|---|
| "Sam's office has 4 recessed ceiling lights on a dimmer" | Create Load (Ceiling Lights, Fixture_Count=4), Create Receptacle (Dimmer Switch, controls Ceiling Lights) |
| "Circuit 1 controls all lights and receptacles in the basement TV room" | assign_circuit: circuit 1, area "Basement TV Room", assign_all=true |
| "There's a 3-gang box on the north wall — dimmer, on/off switch, and a smart switch" | Create 3 Receptacles, Loc.Direction=N, Loc.Rec.Index=same group |
| "Add a GFCI outlet by the sink on circuit 12" | Create Receptacle (GFCI Outlet), assign to Circuit 12 |
| "The living room has a ceiling fan, two floor lamps, and the TV" | Create 3 Loads: Ceiling Fan (type: Fan), Floor Lamps (Fixture_Count: 2, type: Lamp), TV (type: Appliance) |

### Parsing Strategy

The LLM handles all parsing — no custom NLP needed. The system prompt instructs it to:

1. Extract **entities** (rooms, loads, receptacles, circuits) from natural language
2. Map to **table operations** with appropriate field values
3. Infer **Device Type** from context (light, appliance, fan, etc.)
4. Extract **Fixture_Count** from quantity words ("4 recessed lights" → 4)
5. Parse **location** descriptors ("north wall" → Loc.Direction: "N")
6. Detect **multi-gang** groupings and assign shared Loc.Rec.Index
7. Identify **control relationships** ("dimmer controls the ceiling lights" → Load Name(s) link)

### Disambiguation Flow

```
User: "The ceiling lights are on circuit 3"
AI: (searches for "ceiling lights" → finds 3 matches)

┌─────────────────────────────────────────┐
│  I found multiple "ceiling lights":     │
│                                         │
│  1. Kitchen Ceiling Lights              │
│  2. Basement TV Room Ceiling Lights     │
│  3. Sam's Office Ceiling Lights        │
│                                         │
│  Which one? (or say "all of them")      │
└─────────────────────────────────────────┘
```

If the user is currently viewing a specific room (context injection), the AI should **prefer** matches in that room and note the assumption:

```
User: (viewing Sam's Office) "The ceiling lights are on circuit 3"
AI: I'll assign Sam's Office Ceiling Lights to Circuit 3.

┌─────────────────────────────────────────┐
│  🔗 Link  │ Ceiling Lights → Circuit 3  │
│  (Sam's Office — based on your         │
│   current view)                         │
├─────────────────────────────────────────┤
│  [✓ Confirm]          [✕ Cancel]         │
└─────────────────────────────────────────┘
```

---

## Multi-Gang & 3-Way Switch Handling

### Current Data Model

| Field | Table | Purpose |
|-------|-------|---------|
| `Loc.Direction` | Receptacle | Cardinal direction (N/S/E/W) |
| `Loc.Placement` | Receptacle | Position type (W=Wall, C=Center, F=Floor) |
| `Loc.Rec.Index` | Receptacle | Group index (0=solo, 1+=grouped in same box) |
| `Load Name(s)` | Receptacle | Comma-separated names of loads this switch controls |

### Voice → Data Mapping

| Voice Input | Data Outcome |
|---|---|
| "3-gang box on the north wall" | 3 receptacles, all with `Loc.Direction: "N"`, `Loc.Placement: "W"`, `Loc.Rec.Index: <next available>` |
| "The dimmer controls the ceiling lights" | Receptacle.`Load Name(s)` = "Ceiling Lights" |
| "There's a 3-way switch for the hallway light" | 2 Receptacles (both On/Off Switch), both with `Load Name(s)` = "Hallway Light" — AI asks "Where are the two switches located?" |
| "The switch by the door and the one at the top of the stairs both control the stairway light" | 2 Receptacles with same `Load Name(s)` value |

### AI Behavior for Multi-Gang

When the AI detects a multi-gang scenario:
1. Creates all receptacles in the group with the **same `Loc.Rec.Index`**
2. Auto-increments from the highest existing index in that area
3. Sets `Loc.Direction` from voice cues ("north wall", "by the door on the east side")
4. If direction not stated, **asks**: "Which wall is this box on?"

### AI Behavior for 3-Way

When the AI detects "3-way" or "two switches control the same thing":
1. Creates (or identifies) 2 receptacles
2. Asks for locations of each switch if not provided
3. Sets both to have the same `Load Name(s)` value
4. The floor plan will automatically render traveler lines between them

---

## Audit / Verification Flow

### Use Case: "I'm in the kitchen — what do you have?"

```
User: "What's in the kitchen?"
AI: (queries Area "Kitchen" → linked Loads + Receptacles)

Here's what I have for the Kitchen:

┌─ Loads ─────────────────────────────────────┐
│ • Kitchen Ceiling Lights (4x, Circuit 9)    │
│ • Fridge (Appliance, Circuit 12)            │
│ • Dishwasher (Appliance, Circuit 12)        │
│ • Microwave (Appliance, Circuit 14)         │
└─────────────────────────────────────────────┘
┌─ Receptacles ───────────────────────────────┐
│ • Counter GFCI (GFCI Outlet, Circuit 9)     │
│ • Sink GFCI (GFCI Outlet, Circuit 9)        │
│ • Island Dimmer (Dimmer Switch, Circuit 9)  │
└─────────────────────────────────────────────┘

Anything to add or fix?
```

### Use Case: "Make sure the kitchen has a garbage disposal"

```
User: "Make sure the kitchen has a garbage disposal"
AI: (searches Loads in Kitchen for "garbage disposal" → no match)

I don't see a garbage disposal in the Kitchen. Want me to add one?

┌─────────────────────────────────────────────┐
│ ＋Create │ Load │ Kitchen Garbage Disposal   │
│          │      │ Type: Appliance            │
│          │      │ Area: Kitchen              │
│          │      │ Circuit: (unassigned)      │
├─────────────────────────────────────────────┤
│ What circuit is it on? (or I can leave it   │
│ unassigned for now)                         │
├─────────────────────────────────────────────┤
│  [✓ Create without circuit]  [✕ Cancel]      │
└─────────────────────────────────────────────┘
```

---

## Mobile/Tablet UX Considerations

### Layout Priority

| Priority | Design Choice |
|----------|--------------|
| 1 | Large tap targets for mic button (56px minimum) |
| 2 | Confirmation table scrollable horizontally on phone |
| 3 | Voice feedback (pulsing indicator) visible above keyboard |
| 4 | One-hand operation: mic button bottom-right, confirm bottom-center |
| 5 | Interim transcription shows at top of input area (doesn't shift layout) |

### Suggested Screen Flow (Tablet)

```
┌──────────────────────────────────────────┐
│  ← Ask Ohm                        [⚙️]  │
├──────────────────────────────────────────┤
│                                          │
│  [AI] What room are you in?              │
│                                          │
│  [You] 🎤 "Sam's office"               │
│                                          │
│  [AI] Got it! What's in Sam's Office?   │
│                                          │
│  [You] 🎤 "4 recessed ceiling lights     │
│         on a dimmer, north wall,         │
│         and an outlet on the east wall"  │
│                                          │
│  [AI] Here's what I'll add:             │
│  ┌────────────────────────────────────┐  │
│  │ Action │ Item           │ Details  │  │
│  │ Create │ Ceiling Lights │ Qty: 4   │  │
│  │ Create │ N-Wall Dimmer  │ Controls │  │
│  │        │                │ lights   │  │
│  │ Create │ E-Wall Outlet  │ Standard │  │
│  ├────────────────────────────────────┤  │
│  │ [✓ Confirm All]    [✕ Cancel]      │  │
│  └────────────────────────────────────┘  │
│                                          │
├──────────────────────────────────────────┤
│  [message input...              ] [🎤]   │
└──────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1a: Voice Input (Small)

| Task | Files | Effort |
|------|-------|--------|
| `VoiceInput.svelte` component | `src/lib/components/chat/VoiceInput.svelte` | 1 day |
| Integrate mic button into chat input | `ChatPanel.svelte`, `+page.svelte` (chat) | 0.5 day |
| Visual feedback (pulsing, interim text) | Same component | 0.5 day |

### Phase 1b: Creation Tools (Medium)

| Task | Files | Effort |
|------|-------|--------|
| `create_records` tool | `/api/chat/+server.ts` | 1 day |
| `assign_circuit` tool | `/api/chat/+server.ts` | 1 day |
| `propose_batch` tool | `/api/chat/+server.ts` | 0.5 day |
| Batch execution handler | `/api/chat/+server.ts` (confirmation path) | 1 day |
| Updated system prompt | `/api/chat/+server.ts` | 0.5 day |
| Increase `stopWhen` from 5 → 8 | `/api/chat/+server.ts` | trivial |

### Phase 1c: Batch Confirmation UI (Medium)

| Task | Files | Effort |
|------|-------|--------|
| `BatchConfirmation.svelte` | `src/lib/components/chat/BatchConfirmation.svelte` | 1.5 days |
| New message type `batch-confirmation` | `src/lib/types/chat.ts` | 0.5 day |
| Chat store: handle batch confirm/cancel | `src/lib/stores/chat.svelte.ts` | 0.5 day |
| Responsive card vs table layout | Same component | 0.5 day |

### Phase 1d: Disambiguation & Smart Parsing (System Prompt)

| Task | Files | Effort |
|------|-------|--------|
| Enhanced system prompt with parsing rules | `/api/chat/+server.ts` | 0.5 day |
| Fuzzy matching helper (Levenshtein or similar) | `src/lib/server/fuzzy-match.ts` | 0.5 day |
| Test suite: complex utterances → expected tool calls | `tests/voice-parsing.test.ts` | 1 day |

**Total estimated effort: ~10-11 days**

---

## Data Flow: End-to-End Example

**User says:** "Sam's office has 4 recessed ceiling lights on a dimmer on the north wall, circuit 7"

### Step 1: Voice → Text
```
SpeechRecognition → "Sam's office has 4 recessed ceiling lights on a dimmer on the north wall circuit 7"
```

### Step 2: Text → AI (with context)
```json
{
  "message": "Sam's office has 4 recessed ceiling lights on a dimmer on the north wall circuit 7",
  "context": { "currentRoute": "/chat" },
  "history": [...]
}
```

### Step 3: AI → Tool Calls
The LLM identifies:
- Area: "Sam's Office" (search existing → found, ID=42)
- Load: "Ceiling Lights", Fixture_Count=4, Device Type="Light"
- Receptacle: Dimmer Switch, Loc.Direction="N", Loc.Placement="W"
- Receptacle controls Load
- Circuit 7 assignment

AI calls `propose_batch`:
```json
{
  "summary": "Adding ceiling lights with dimmer to Sam's Office on Circuit 7",
  "operations": [
    { "action": "create", "table": "Load", "label": "Sam's Office Ceiling Lights",
      "fields": { "Name": "Ceiling Lights", "Device Type": "Light", "Fixture_Count": 4 } },
    { "action": "create", "table": "Receptacle", "label": "N-Wall Dimmer",
      "fields": { "Name": "N-Wall Dimmer", "Receptacle Type": "Dimmer Switch",
                  "Loc.Direction": "N", "Loc.Placement": "W", "Load Name(s)": "Ceiling Lights" } },
    { "action": "link", "table": "Load", "label": "Ceiling Lights → Circuit 7",
      "linkTarget": { "table": "Circuit", "recordId": "77" } },
    { "action": "link", "table": "Receptacle", "label": "N-Wall Dimmer → Circuit 7",
      "linkTarget": { "table": "Circuit", "recordId": "77" } },
    { "action": "link", "table": "Load", "label": "Ceiling Lights → Sam's Office",
      "linkTarget": { "table": "Area", "recordId": "42" } },
    { "action": "link", "table": "Receptacle", "label": "N-Wall Dimmer → Sam's Office",
      "linkTarget": { "table": "Area", "recordId": "42" } }
  ]
}
```

### Step 4: UI → Batch Confirmation Table
Rendered as grouped table (see mockup).

### Step 5: User Confirms → Sequential Execution
1. Create Load record → get ID
2. Create Receptacle record → get ID
3. Link Load → Circuit 7 via `replaceLinks()`
4. Link Receptacle → Circuit 7
5. Link Load → Area "Sam's Office"
6. Link Receptacle → Area "Sam's Office"
7. Return success message

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Voice not supported | Hide mic button; text-only mode |
| Voice timeout (no speech) | "I didn't catch that — try again or type it out" |
| Ambiguous room name | List matches, ask to clarify |
| Circuit not found | "I can't find Circuit 15 — which panel is it in?" |
| Partial creation failure | Roll back successful creates; show which failed |
| Network error mid-batch | Pause, show partial progress, offer retry |

---

## Testing Strategy

| Test Type | Coverage |
|-----------|----------|
| Unit tests | Fuzzy matching, field inference, Loc.Rec.Index auto-increment |
| Integration tests | Tool execution (create, link, batch confirm) with mock NocoDB |
| E2E tests | Full voice → confirm → verify record exists |
| Prompt regression | Library of utterances → expected tool call shapes |

---

## Open Decisions

1. **Batch confirmation: table or cards?** — Design mockup provides both; test with real content to pick.
2. **Max operations per batch** — Suggest cap at 20 to prevent overwhelming confirmation UI.
3. **Auto-naming convention** — Propose `{Area} {Descriptor}` (e.g., "Sam's Office Ceiling Lights") — confirm this matches existing naming patterns in the DB.
4. **Loc.Rec.Index assignment** — Auto-increment from max in area, or ask user for explicit group number?

---

## Mockups

See `docs/mockups/` for interactive HTML mockups:
- `voice-config-batch-confirmation.html` — Batch confirmation table (mobile + tablet)
- `voice-input-states.html` — Voice button states and transcription UX
