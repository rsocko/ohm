# Architecture Decision Record: Electrical Config AI UX

## Context

the project owner has a NocoDB instance (`nocodb.example.com`) storing detailed electrical configuration for 2 homes. The data includes areas, panels, circuits, receptacles, and loads. He wants:

1. **AI chat against the data** — ask questions like "which circuit controls the master bath lights?" or "update outlet type to GFCI for the kitchen island"
2. **Mobile-friendly custom UX** — browse, search, and update data on a phone (e.g., while at the breaker panel)
3. **Leverage existing homelab** — Docker on WSL, Ollama, Open-WebUI, Traefik reverse proxy

---

## Options Evaluated

### Option A: Open-WebUI Tool/Function (Lowest Effort)

**How it works:** Create a custom "Tool" in Open-WebUI that wraps NocoDB API calls. The LLM gets function-calling access to query/update your electrical data.

| Pros | Cons |
|------|------|
| Zero new services to deploy | Limited to chat interface only |
| Leverages existing Ollama + Open-WebUI | No custom visual UX (floor plans, panel views) |
| NocoDB MCP server already exists | Mobile UX is just Open-WebUI's chat (acceptable but not optimized) |
| Can start today | Update confirmations are conversational only |

**Effort:** ~2-4 hours  
**Best for:** Getting AI query capability immediately

---

### Option B: Lightweight PWA + AI Chat Panel (Recommended)

**How it works:** A single Docker container running a small web app (Next.js or SvelteKit) that:
- Connects to NocoDB REST API for CRUD
- Provides a mobile-optimized browse/search/edit UI
- Includes an embedded AI chat panel that uses Ollama (via OpenAI-compatible API) with NocoDB context

| Pros | Cons |
|------|------|
| Purpose-built mobile UX | Custom code to build & maintain |
| PWA = installable on phone homescreen | ~1-2 weeks to MVP |
| AI chat integrated inline | Another Docker container |
| Full control over views (panel diagram, room views) | |
| Offline-capable for basic browsing | |
| NocoDB stays as source of truth | |

**Effort:** ~1-2 weeks to MVP  
**Best for:** The full vision — great UX + AI + mobile

---

### Option C: Low-Code Platform (Appsmith/Budibase/Tooljet)

**How it works:** Deploy a self-hosted low-code platform, connect it to NocoDB's underlying database or REST API, build UI visually.

| Pros | Cons |
|------|------|
| Drag-and-drop UI builder | Another heavy service to run |
| Pre-built table/form widgets | AI integration is bolt-on at best |
| Self-hostable | Mobile experience varies (often mediocre) |
| | Learning the platform's quirks |
| | Limited customization for specialized views |

**Effort:** ~3-5 days  
**Best for:** If you want a traditional CRUD UI without AI and don't mind running another platform

---

### Option D: Native iOS App (Swift/React Native)

**How it works:** Build a native mobile app that talks to NocoDB API + Ollama.

| Pros | Cons |
|------|------|
| Best possible mobile experience | Significant dev effort (~4-6 weeks) |
| Native gestures, offline, push notifications | App Store deployment complexity (or TestFlight) |
| | Two codebases if you also want desktop access |
| | Overkill for data that changes infrequently |

**Effort:** 4-6 weeks  
**Best for:** If this were a product for many users. Overkill for personal use.

---

## Recommendation: Hybrid Approach (A now → B soon)

### Phase 1: Immediate AI Access (Option A) — Today

Deploy the **NocoDB MCP server as an Open-WebUI Tool**. This gives you:
- Natural language queries against your electrical data immediately
- Zero new infrastructure
- A way to validate what questions/interactions are most useful before building custom UI

**Implementation:**
1. The NocoDB MCP config you already generated can be used with Open-WebUI's "Tools" feature
2. Register it as an Open-WebUI function/tool that wraps the MCP endpoints
3. You can now chat: "What circuit is the garage door opener on?" → gets live data from NocoDB

### Phase 2: Custom Mobile PWA (Option B) — 1-2 Weeks

Build a **lightweight PWA** with these characteristics:

**Tech Stack:**
- **Framework:** SvelteKit (lighter than Next.js, excellent mobile perf, SSR + client hydration)
- **Styling:** Tailwind CSS (rapid mobile-first design)
- **AI:** Direct Ollama OpenAI-compatible API calls from the server
- **Data:** NocoDB REST API v2
- **Deployment:** Single Docker container behind Traefik
- **Domain:** e.g., `electrical.example.com`

**Why SvelteKit over Next.js:**
- Smaller bundle size (critical for mobile)
- Simpler mental model
- Excellent PWA support via `@vite-pwa/sveltekit`
- Server routes for proxying Ollama/NocoDB (keeps API keys server-side)

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────┐
│                   User's Phone                       │
│              (PWA installed to homescreen)           │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS
                       ▼
┌──────────────────────────────────────────────────────┐
│                    Traefik                            │
│            (electrical.example.com)                      │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│           SvelteKit PWA Container                    │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Browse/     │  │  AI Chat     │  │  Search   │  │
│  │ Edit UI     │  │  Panel       │  │  Engine   │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                │                 │         │
│  ┌──────┴────────────────┴─────────────────┴─────┐  │
│  │           Server Routes (API Proxy)           │  │
│  └──────┬────────────────┬───────────────────────┘  │
└─────────┼────────────────┼───────────────────────────┘
          │                │
          ▼                ▼
┌──────────────┐   ┌──────────────┐
│   NocoDB     │   │   Ollama     │
│  REST API    │   │  (local LLM) │
│              │   │              │
│ Tables:      │   │ Models:      │
│ - Areas      │   │ - llama3.1   │
│ - Panels     │   │ - mistral    │
│ - Circuits   │   │ - etc.       │
│ - Receptacles│   │              │
│ - Loads      │   │              │
└──────────────┘   └──────────────┘
```

---

## Key UX Features for the PWA

### 1. **Quick Lookup Mode** (Primary mobile use case)
- Open app → type or speak "garage outlets" → instant filtered results
- Shows: room, circuit #, panel, breaker amp, outlet type
- One-tap to see full details or navigate to that circuit's other loads

### 2. **Panel View**
- Visual representation of each breaker panel
- Tap a breaker → see all loads on that circuit
- Color coding: GFCI (green), AFCI (blue), standard (gray), unknown (red)

### 3. **Room/Area Browser**
- Hierarchical: Home → Floor → Room → Devices
- Each device shows circuit, type, notes
- Inline edit for quick updates

### 4. **AI Chat**
- Floating chat button (bottom-right)
- Context-aware: "what else is on this circuit?" when viewing a specific circuit
- Can execute updates: "mark all kitchen outlets as GFCI" → confirmation → batch update

### 5. **Offline Support**
- Service worker caches the full dataset (small enough at ~500 records)
- Queued updates sync when back online
- AI chat requires connectivity (Ollama is on the network)

---

## AI Integration Detail

### System Prompt for the Electrical Assistant

```
You are an electrical configuration assistant for the project owner's homes. You have access 
to NocoDB tables containing: Areas, Panels, Circuits, Receptacles, and Loads.

When answering questions:
- Be specific with circuit numbers and panel locations
- If a query is ambiguous (multiple matches), list all and ask for clarification
- For update requests, always confirm before executing
- Reference data by room/area name for human-friendliness

You can:
- Query any table with filters
- Update records (with user confirmation)
- Cross-reference (e.g., find all loads on a circuit, all circuits in a panel)
```

### Tool Definitions (for function calling)

```json
[
  {
    "name": "query_electrical_data",
    "description": "Search electrical configuration data",
    "parameters": {
      "table": "string (Areas|Panels|Circuits|Receptacles|Loads)",
      "filters": "object (field conditions)",
      "fields": "array of field names to return"
    }
  },
  {
    "name": "update_electrical_record",
    "description": "Update a record in the electrical database",
    "parameters": {
      "table": "string",
      "record_id": "string",
      "updates": "object (field: new_value pairs)"
    }
  },
  {
    "name": "cross_reference",
    "description": "Find related records across tables",
    "parameters": {
      "from_table": "string",
      "from_id": "string", 
      "to_table": "string"
    }
  }
]
```

---

## Docker Deployment

```yaml
# docker-compose.yml (addition to existing stack)
services:
  electrical-ui:
    build: ./electrical-config-ai
    container_name: electrical-ui
    restart: unless-stopped
    environment:
      - NOCODB_URL=http://nocodb:8080
      - NOCODB_TOKEN=${NOCODB_API_TOKEN}
      - OLLAMA_URL=http://ollama:11434
      - OLLAMA_MODEL=llama3.1:8b
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.electrical.rule=Host(`electrical.example.com`)"
      - "traefik.http.routers.electrical.tls.certresolver=letsencrypt"
    networks:
      - proxy
      - internal
```

---

## Model Recommendation for AI Chat

For this use case (structured data queries, small context window needed):

| Model | Why | Tradeoff |
|-------|-----|----------|
| **llama3.1:8b** | Fast, good at structured tasks, function calling support | May struggle with complex multi-hop queries |
| **mistral:7b** | Excellent instruction following | Slightly less capable at tool use |
| **qwen2.5:14b** | Best function calling in this size range | Needs more VRAM |
| **llama3.1:70b** (desktop) | Superior reasoning for complex queries | Only on powerful desktop |

**Recommendation:** Use `qwen2.5:14b` or `llama3.1:8b` as default. The dataset is small enough to include full schema + relevant records in context without RAG.

---

## Phase 4: Interactive Floor Plan

### Overview

A visual, interactive floor plan layer that shows the physical location of every receptacle, switch, fixture, and load — mapped to their circuit data. This is the spatial complement to the tabular/chat views.

### Data Model Addition

New fields needed in NocoDB (or a new `DeviceLocations` table):

```
DeviceLocations table:
- id (auto)
- device_id (link to Receptacles or Loads)
- device_type (receptacle | switch | fixture | load)
- floor_plan_id (link to FloorPlans)
- x_position (float, 0-100 as % of plan width)
- y_position (float, 0-100 as % of plan height)
- rotation (optional, degrees)

FloorPlans table:
- id (auto)
- home_id (link to home)
- name ("1st Floor", "2nd Floor", "Exterior")
- image_url (uploaded floor plan image path)
- width_px (original image width)
- height_px (original image height)
```

Positions stored as percentages make the layout responsive regardless of display size.

### Core Features (Phase 4a)

#### Interactive Map View
- **Pan & zoom** — touch gestures on mobile, scroll/drag on desktop
- **Device markers** overlaid on floor plan image:
  - 🟢 Green circles = GFCI outlets
  - ⚪ Gray circles = Standard outlets
  - 🟣 Purple squares = Switches
  - 🟡 Amber diamonds = Fixtures/lights
  - 🔴 Red = Unknown/unmapped
- **Tap a marker** → bottom sheet shows device details + circuit info
- **Circuit highlight mode** — toggle to color-code all markers by circuit
  - Tapping a circuit in the panel view could navigate here with that circuit pre-highlighted
- **Floor selector** — tab between floors (some circuits span multiple floors, markers light up on both)
- **Desktop layout** — side-by-side: floor plan (left 60%) + detail panel (right 40%)

#### AI Chat Integration
- When asking "where is circuit 7?" → AI responds with text AND triggers the floor plan view with circuit 7 highlighted
- "Show me all GFCI outlets on the first floor" → floor plan opens with those markers pulsing
- Context-aware: if viewing the floor plan and tapping the AI chat, the question gets floor plan context ("I'm looking at the kitchen area")

#### Cross-Floor Circuit Visualization
- When a circuit spans multiple floors, show a small multi-floor indicator
- Option to view "all floors" stacked/overlaid or switch between them
- Small minimap showing which floors have activity for the selected circuit

### Advanced Features (Phase 4b)

#### Floor Plan Upload & Device Placement
- **Upload interface:** Drag-and-drop or camera photo of a floor plan/blueprint
- **Calibration:** Set scale (drag to mark a known distance, e.g., "this wall is 12ft")
- **Device placement mode:**
  - Tap on the plan to place a new device marker
  - Picker appears: select device type → link to existing NocoDB record or create new
  - Drag markers to reposition
  - Long-press to delete
- **Bulk import from draw.io:**
  - Provide a draw.io template with electrical symbol stencils
  - User draws their floor plan in draw.io (free, works on any device)
  - Export as SVG → import into the app
  - App parses SVG layers to extract marker positions
  - User maps markers to NocoDB records via a guided wizard

#### Draw.io Integration Pattern
```
┌─────────────────────────────────────────────────────────────┐
│  Option A: In-App Placement (simpler)                        │
│  - Upload any image (photo, scan, sketch)                    │
│  - Tap to place markers directly in the PWA                  │
│  - Positions saved to NocoDB DeviceLocations table           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Option B: Draw.io External Tool (more precise)              │
│  - Provide custom draw.io library with electrical symbols    │
│  - User creates floor plan with labeled shapes               │
│  - Export as SVG with metadata (shape IDs = device names)    │
│  - Import SVG into app → auto-maps shapes to NocoDB records  │
│  - Best for: detailed, precise architectural plans           │
└─────────────────────────────────────────────────────────────┘

│  Option C: Hybrid                                            │
│  - Use draw.io for the floor plan base (walls, rooms)        │
│  - Import as background image into the PWA                   │
│  - Place device markers in-app on top of the imported plan   │
└─────────────────────────────────────────────────────────────┘
```

**Recommendation:** Start with **Option C (Hybrid)** — draw.io for the floor plan artwork, in-app for device placement. This separates the hard problem (floor plan drawing) from the data problem (device positioning).

### Super Advanced (Phase 4c) — AR/VR & Import/Export

#### AR Mode (iPhone 16 Pro)
- **ARKit + LiDAR:** iPhone 16 Pro has a LiDAR scanner — could place virtual markers in real space
- **Implementation:** Would require a native Swift component (not PWA-compatible)
- **Use case:** Point phone at a wall → see overlaid info about outlets and their circuits
- **Feasibility:** Medium-high effort (~4-6 weeks), requires native iOS development
- **Alternative lightweight AR:** Use the camera + object detection to identify outlet covers, then overlay data. Simpler but less precise.

#### WebXR (PWA-compatible, no native app)
- **WebXR Device API** can provide basic AR in Safari on iPhone
- More limited than ARKit but works within the PWA
- Could show simple floating labels when pointing at walls
- **Feasibility:** Experimental, limited Safari support, not recommended for MVP

#### Import/Export
- **Export formats:**
  - SVG floor plan with embedded device metadata
  - PDF report (floor plan + circuit schedule)
  - CSV of all device locations
  - JSON (full data dump for backup/migration)
- **Import formats:**
  - Draw.io XML/SVG
  - Home Assistant floor plan YAML (if you've already mapped rooms there)
  - Image files (PNG, JPG, PDF) as floor plan backgrounds

### Technology Choices for Floor Plan

| Component | Technology | Why |
|-----------|-----------|-----|
| Rendering | SVG + Canvas hybrid | SVG for markers (interactive), Canvas for background image (performant zoom) |
| Pan/Zoom | `panzoom` or `d3-zoom` library | Battle-tested, touch-friendly |
| Marker overlay | SVG `<g>` elements positioned by % | Responsive, resolution-independent |
| Mobile gestures | Hammer.js or native touch events | Pinch-to-zoom, pan, tap |
| Desktop | Same tech, larger viewport | Side panel for details instead of bottom sheet |
| AR (future) | ARKit (native) or WebXR (web) | LiDAR on iPhone 16 Pro enables room scanning |

### Floor Plan UX Mockup Description

```
┌─────────────────────────────────────────────────────────┐
│  ← Floor Plan          [1st Floor] [2nd] [Ext]         │
├─────────────────────────────────────────────────────────┤
│  [+] [-] [⊡] [☰ Layers]    [Circuit Highlight: ON]     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌─────────────────────────────────────────────────┐   │
│   │          FLOOR PLAN IMAGE                       │   │
│   │                                                 │   │
│   │    ┌──────────┐  ┌───────────────┐             │   │
│   │    │ Kitchen  │  │  Living Room  │             │   │
│   │    │  ●  ●    │  │    ●     ●    │             │   │
│   │    │  ◆  ■    │  │  ■   ◆       │             │   │
│   │    └──────────┘  └───────────────┘             │   │
│   │    ┌──────────┐  ┌───────────────┐             │   │
│   │    │ Garage   │  │    Office     │             │   │
│   │    │  ●  ●  ● │  │  ●  ●  ◆     │             │   │
│   │    └──────────┘  └───────────────┘             │   │
│   │                                                 │   │
│   └─────────────────────────────────────────────────┘   │
│                                                         │
│  Legend: ● Outlet  ■ Switch  ◆ Fixture                  │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐    │
│  │ Kitchen Counter Outlet (N wall)                 │    │
│  │ Circuit 7 · Main Panel · 20A  [GFCI]           │    │
│  │                                                 │    │
│  │ [View Circuit]  [Edit]  [Show on All Floors]    │    │
│  └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│  🏠   ⚡   🏢   🗺️   💬                               │
│ Home  Panels Rooms Map  Ask AI                          │
└─────────────────────────────────────────────────────────┘
```

### Desktop Layout (wider viewport)

```
┌────────────────────────────────────────────────────────────────────────┐
│  Electrical Config — Floor Plan                    [Boynton] [Milford] │
├──────────────────────────────────────────┬─────────────────────────────┤
│                                          │  Selected: Kitchen Counter  │
│         FLOOR PLAN                       │  Outlet (N wall, left)      │
│         (large, zoomable)                │                             │
│                                          │  Circuit: 7 (Main Panel)    │
│    Markers visible and interactive       │  Breaker: 20A GFCI          │
│                                          │  Wire: 12/2 Romex           │
│                                          │                             │
│                                          │  Other loads on Circuit 7:  │
│                                          │  • Counter outlet (right)   │
│                                          │  • Under-cabinet lights     │
│                                          │  • Disposal                 │
│                                          │                             │
│                                          │  [Edit] [View in Table]     │
│                                          │                             │
│  [+][-][⊡] Circuit: [All ▾]             │  ─── AI Chat ───            │
│  Legend: ● ■ ◆                           │  Ask about this location... │
└──────────────────────────────────────────┴─────────────────────────────┘
```

### Phase 4 Timeline

| Sub-phase | Effort | Deliverable |
|-----------|--------|-------------|
| 4a: Core floor plan viewer | 3-5 days | Pan/zoom, markers, tap-to-info, circuit highlight |
| 4a+: AI integration | 1-2 days | Chat triggers map highlights, map context in chat |
| 4b: Upload & placement | 3-5 days | Upload image, tap-to-place markers, save positions |
| 4b+: Draw.io template | 1-2 days | Custom library + import/parse SVG |
| 4c: AR exploration | 4-6 weeks | Native ARKit prototype (stretch goal) |
| 4c: Import/export | 2-3 days | SVG, PDF, CSV, JSON export |

---

## What I'd Need to Proceed to Implementation

1. **NocoDB schema details** — exact table names, column names, relationships (I can get this via the MCP server if you want to connect me)
2. **Decision on Phase 1 vs Phase 2** — want to start with Open-WebUI tool first, or jump to the PWA?
3. **Model preference** — which Ollama model(s) do you want to use?
4. **Auth requirement** — should the PWA have a login, or is network-level security (Traefik + LAN only) sufficient?
5. **Floor plans** — do you have existing floor plans (blueprints, sketches, photos) for either home? Or should we plan for creation from scratch?

---

## Phase 1.5: Siri Voice Bridge (iOS Shortcuts + PWA API)

### How It Works

Siri doesn't understand MCP — it's purely a voice trigger for iOS Shortcuts. MCP is a protocol between AI agents and data sources (Claude, Open-WebUI, etc.), not something iOS can speak natively.

However, Siri + Shortcuts can make HTTP requests to **any local LAN endpoint** — no internet required. The Shortcut itself contains the endpoint URL (e.g., `http://electrical.local/api/ask` or `http://192.168.1.x:3000/api/ask`).

```
┌─────────────────────────────────────────────────────────────┐
│  "Hey Siri, ask electrical what circuit the pool pump is on" │
└──────────────────────────┬──────────────────────────────────┘
                           │ Voice → text transcription (on-device)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│              iOS Shortcut: "Ask Electrical"                    │
│                                                              │
│  1. "Ask for Input" or use Siri's transcription              │
│  2. "Get Contents of URL"                                    │
│     → POST http://electrical.local/api/ask                   │
│     → Body: { "question": "<transcribed text>" }             │
│  3. "Get value from JSON" → extract .answer                  │
│  4. "Speak Text" → reads answer aloud                        │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTP (local WiFi, no internet)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│           SvelteKit PWA — /api/ask endpoint                   │
│                                                              │
│  1. Receives question text                                   │
│  2. Builds prompt with NocoDB schema context                 │
│  3. Calls Ollama (function calling) to query NocoDB          │
│  4. Returns plain text answer                                │
└──────────────────────────────────────────────────────────────┘
```

### Key Points

- **No internet needed** — Shortcut hits LAN IP or `.local` hostname
- **Siri is just the voice trigger** — all logic is in the Shortcut + your server
- **MCP stays where it belongs** — in Open-WebUI and other AI agent tools, not Siri
- **Works hands-free** — perfect for when you're at the panel with dirty hands

### Why Not Use MCP Directly from Siri?

MCP requires a compatible client runtime (JSON-RPC over stdio/SSE). iOS Shortcuts can only do simple HTTP requests. The bridge pattern (Shortcut → your API → Ollama → NocoDB) gives you the same result with technology Siri can actually use.

### iOS Shortcut Setup

```
Shortcut: "Ask Electrical"
──────────────────────────
1. [Ask for Input] — "What do you want to know?"
   (or skip if Siri passes the phrase directly)

2. [URL] — http://electrical.local:3000/api/ask

3. [Get Contents of URL]
   Method: POST
   Headers: Content-Type: application/json
   Body (JSON): { "question": "[Provided Input]" }

4. [Get Value from Dictionary] — key: "answer"

5. [Speak Text] — speak the answer aloud

Optional: [Show Result] — also display on screen
```

**Effort:** ~2-4 hours (API endpoint + Shortcut creation)

---

## Phase 3: Home Assistant Integration

### Why This Fits Naturally

Your NocoDB electrical data maps directly to Home Assistant's domain model:

| NocoDB Table | HA Concept | Connection |
|--------------|-----------|------------|
| Areas | HA Areas/Rooms | Same physical spaces |
| Circuits | — (no native equivalent) | New entities |
| Receptacles | HA Devices/Entities | Z-Wave switches, smart plugs already in HA |
| Loads | HA Devices | Lights, fans, etc. you already control |
| Panels | — | Organizational grouping |

The key insight: **your HA already knows about many of these devices** (Z-Wave switches, smart outlets). NocoDB adds the _electrical context_ (which breaker, what circuit, wire gauge, GFCI status) that HA doesn't track.

### Integration Approaches (Ranked)

#### Approach A: RESTful Sensors + Panel Iframe (Lowest Effort) ⭐

Use HA's built-in REST integration to pull data from NocoDB, plus embed your PWA as an iframe panel.

**`configuration.yaml`:**
```yaml
# Pull circuit data as sensors
rest:
  - resource: "http://nocodb:8080/api/v2/meta/bases/your_nocodb_base_id/tables/Circuits/records"
    method: GET
    headers:
      xc-auth: "YOUR_NOCODB_TOKEN"
    scan_interval: 300  # refresh every 5 min
    sensor:
      - name: "Total Circuits"
        value_template: "{{ value_json.list | length }}"
      - name: "GFCI Circuits"
        value_template: "{{ value_json.list | selectattr('breaker_type', 'eq', 'GFCI') | list | length }}"

# Embed the PWA as a sidebar panel
panel_iframe:
  electrical:
    title: "Electrical Config"
    url: "http://electrical.local:3000"
    icon: "mdi:flash"
    require_admin: false

# REST commands to update NocoDB from HA automations
rest_command:
  update_circuit_status:
    url: "http://nocodb:8080/api/v2/meta/bases/your_nocodb_base_id/tables/Circuits/records/{{ record_id }}"
    method: PATCH
    headers:
      xc-auth: "YOUR_NOCODB_TOKEN"
      Content-Type: "application/json"
    payload: '{{ payload }}'
```

**Effort:** ~2-4 hours  
**Gives you:** Circuit data visible in HA dashboards, PWA accessible from HA sidebar, ability to update NocoDB from automations.

#### Approach B: Custom Integration (HACS-installable) — Medium Effort

A proper HA custom integration (`custom_components/nocodb_electrical/`) that:
- Creates entities for each circuit (with attributes: amp rating, type, loads count)
- Links circuits to existing HA areas
- Provides services: `nocodb_electrical.query`, `nocodb_electrical.update_record`
- Syncs bidirectionally (HA area changes → NocoDB, NocoDB updates → HA entities)

```python
# custom_components/nocodb_electrical/sensor.py (simplified)
class CircuitSensor(SensorEntity):
    """Represent a single electrical circuit."""
    
    def __init__(self, circuit_data):
        self._attr_name = f"Circuit {circuit_data['number']} - {circuit_data['label']}"
        self._attr_native_value = circuit_data['status']
        self._attr_extra_state_attributes = {
            "panel": circuit_data['panel_name'],
            "breaker_amps": circuit_data['amps'],
            "breaker_type": circuit_data['type'],  # GFCI, AFCI, Standard
            "loads_count": circuit_data['loads_count'],
            "area": circuit_data['area_name'],
        }
```

**Effort:** ~1-2 weeks  
**Gives you:** First-class HA entities, automations that reference circuits, Lovelace cards.

#### Approach C: Bidirectional Entity Linking — Advanced

The most powerful option: **link your NocoDB receptacles/loads to their actual HA entities** (Z-Wave switches, smart plugs).

**Concept:** Add an `ha_entity_id` field to your NocoDB Receptacles/Loads tables. This creates a mapping:

```
NocoDB: Kitchen Island Outlet 2 (Circuit 9, GFCI, 20A)
    ↕ linked to
HA: switch.kitchen_island_zwave_outlet_2 (Z-Wave, controllable)
```

**This enables:**
- "Hey Siri, what circuit is the kitchen island switch on?" → looks up HA entity → finds NocoDB record → "Circuit 9, Main Panel, 20A GFCI"
- HA automation: if a breaker trips (via smart panel monitor), mark all linked entities as unavailable
- Dashboard: tap a Z-Wave switch in HA → see its full electrical context (circuit, panel, wire gauge)
- Safety alerts: "Circuit 9 has 6 loads totaling estimated 14A on a 20A breaker"

**Implementation:**
```yaml
# HA automation: when a device goes unavailable, log to NocoDB
automation:
  - alias: "Log circuit issues"
    trigger:
      - platform: state
        entity_id: switch.kitchen_island_outlet
        to: "unavailable"
    action:
      - service: rest_command.update_circuit_status
        data:
          record_id: "rec_abc123"
          payload: '{"status": "issue_detected", "last_event": "{{ now() }}"}'
```

**Effort:** ~2-3 weeks (including entity mapping data entry)  
**Gives you:** True smart-home-meets-electrical-documentation. Live circuit awareness.

### Recommended HA Approach: A now → B later → C as stretch goal

| Phase | What | When |
|-------|------|------|
| **3a** | Panel iframe + REST sensors | With Phase 2 (same deployment) |
| **3b** | Custom integration with circuit entities | After PWA MVP works |
| **3c** | Bidirectional entity linking | When entity mapping is populated |

### HA Dashboard Card (Mock)

```yaml
# Lovelace card showing circuit info for a room
type: custom:auto-entities
card:
  type: entities
  title: "Kitchen - Electrical"
filter:
  include:
    - attributes:
        area: "Kitchen"
      options:
        secondary_info: attribute
        attribute: panel
```

---

## Revised Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                        User Interfaces                              │
├──────────┬──────────────┬─────────────────┬───────────────────────┤
│  iPhone  │   PWA        │  Home Assistant  │  Open-WebUI          │
│  Siri    │  (mobile     │  Dashboard +     │  (AI chat with       │
│  Shortcut│   browser)   │  Iframe + Cards  │   MCP tools)         │
└────┬─────┴──────┬───────┴────────┬─────────┴──────────┬───────────┘
     │            │                │                     │
     │ HTTP/LAN   │ HTTP/LAN       │ HTTP/LAN            │ MCP protocol
     ▼            ▼                ▼                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                    SvelteKit PWA Server                            │
│                  (electrical.local:3000)                           │
│                                                                   │
│  /api/ask ←─── Siri Shortcuts                                    │
│  /api/query ←── HA REST sensors                                  │
│  /api/update ←── HA rest_commands                                │
│  UI routes ←── Browser / HA iframe                               │
└─────────────────────┬────────────────────┬────────────────────────┘
                      │                    │
                      ▼                    ▼
              ┌──────────────┐     ┌──────────────┐
              │   NocoDB     │     │   Ollama     │
              │  REST API    │     │  (LLM)       │
              │              │     │              │
              │ + MCP Server │◄────│  (used by    │
              │   endpoint   │     │  Open-WebUI  │
              └──────────────┘     │  directly)   │
                                   └──────────────┘
```

---

## Phase 5: Live Energy Monitoring + Device Control

### Overview

By bridging Home Assistant's real-time data (Emporia Vue per-circuit energy monitoring, Z-Wave device states and control) into the electrical config app, we transform it from a **static reference tool** into a **live operational dashboard**. You go from "what circuit is this?" to "what circuit is this, how much power is it drawing right now, and can I turn that light off?"

### Data Sources

| Source | Data | Access Method |
|--------|------|---------------|
| **Emporia Vue** (via HA) | Per-circuit real-time watts, historical kWh, cost | HA REST API or WebSocket |
| **Z-Wave switches** (via HA) | On/off state, power monitoring (some devices) | HA REST API for state, WebSocket for real-time |
| **Home Assistant** | Entity states, areas, energy dashboard data | Long-lived access token + REST/WS API |
| **NocoDB** | Circuit ↔ device mapping, electrical metadata | REST API (existing) |

### Architecture Addition

```
┌──────────────────────────────────────────────────────────────────┐
│                    SvelteKit PWA Server                            │
│                                                                   │
│  Existing:                    New:                                │
│  /api/ask                     /api/energy/live (WebSocket proxy)  │
│  /api/query                   /api/energy/history/:circuit        │
│  /api/update                  /api/devices/state                  │
│  UI routes                    /api/devices/control (POST)         │
│                               /api/alerts                         │
└──────────┬───────────────────────┬────────────────────────────────┘
           │                       │
           ▼                       ▼
   ┌──────────────┐       ┌──────────────────────┐
   │   NocoDB     │       │   Home Assistant      │
   │  (config)    │       │   WebSocket API       │
   │              │       │                        │
   │  Circuit     │◄─────►│  Emporia Vue entities │
   │  metadata    │ linked │  Z-Wave devices       │
   │              │       │  Energy dashboard      │
   └──────────────┘       └──────────────────────┘
```

### Feature Set

#### 5a: Live Energy Dashboard

- **Real-time total power** with sparkline (via HA WebSocket subscription)
- **Per-circuit wattage ranking** — which circuits are drawing the most right now
- **Cost estimates** — daily/monthly based on your utility rate
- **Time range views** — Live, 1H, 24H, 7D, 30D
- **Peak alerts** — "Circuit 7 hit 76% capacity at 7:32 AM"
- **Trend indicators** — is usage going up/down/steady on each circuit

#### 5b: Device Control

- **Smart device cards** — see all controllable Z-Wave devices with:
  - Current on/off state (live-updating via WebSocket)
  - Toggle switch to turn on/off directly from the app
  - Energy consumed today (from Emporia Vue or device-level monitoring)
  - Link to which circuit powers the device
- **Contextual control** — when viewing a circuit, see and control all smart devices on it
- **Voice control via Siri bridge** — "Hey Siri, turn off the office lights" → Shortcut → PWA API → HA service call
- **Floor plan integration** — controllable devices get a special marker; tap to toggle right from the map

#### 5c: Smart Insights & Alerts

| Insight Type | Example | Action |
|-------------|---------|--------|
| **Capacity warning** | "Circuit 7 peaked at 15.2A (76% of 20A)" | View loads, suggest rebalancing |
| **Waste detection** | "Office lights on 14 hrs, no motion detected" | "Turn Off" button |
| **Anomaly detection** | "Pool pump usage up 23% vs last week" | Suggest maintenance check |
| **Cost optimization** | "A/C ran 18 hrs yesterday ($8.40)" | Suggest schedule adjustment |
| **Safety alerts** | "Circuit 12 showing unusual patterns" | Flag for inspection |

#### 5d: Historical Analytics

- **Per-circuit usage charts** — hourly/daily/weekly/monthly
- **Cost breakdown by circuit** — pie/bar chart of where money goes
- **Comparison** — this month vs last month, this week vs last week
- **Time-of-use optimization** — if on a TOU rate plan, show when you're using expensive power

### AI Integration for Energy

The AI assistant gains new capabilities:

```
System prompt addition:
You also have access to live energy data from the Emporia Vue monitor and can 
control Z-Wave devices via Home Assistant. You can:
- Report current power draw per circuit
- Show historical usage and costs
- Turn devices on/off (with user confirmation)
- Detect and alert on unusual patterns
- Suggest energy optimization strategies
```

**Example conversations:**
- "How much is the pool pump costing me this month?" → queries HA history → "$47.20 at current rates"
- "Turn off all the lights upstairs" → identifies Z-Wave entities in upstairs area → confirms → executes
- "Why is my electric bill high this month?" → analyzes per-circuit trends → "A/C ran 40% more due to heat wave, pool pump usage also up 23%"
- "What's drawing the most power right now?" → real-time query → ranked list

### HA WebSocket Integration

For live data, the PWA server maintains a WebSocket connection to Home Assistant:

```javascript
// Server-side: subscribe to energy entities
const ha_ws = new WebSocket('ws://homeassistant.example:8123/api/websocket');

// Subscribe to Emporia Vue entities (one per circuit)
ha_ws.send(JSON.stringify({
  type: 'subscribe_entities',
  entity_ids: [
    'sensor.emporia_vue_circuit_1_power',
    'sensor.emporia_vue_circuit_2_power',
    // ... all circuits
    'switch.office_light',
    'switch.kitchen_pendant',
    // ... controllable devices
  ]
}));

// Forward to client via Server-Sent Events or client WebSocket
// This avoids exposing HA tokens to the browser
```

### Control Safety

For device control, implement safeguards:

1. **Confirmation for destructive actions** — "Turn off ALL lights?" requires explicit confirm
2. **Audit log** — every control action logged with timestamp and source (app/voice/automation)
3. **Rate limiting** — prevent accidental rapid toggling
4. **Read-only mode** — option to disable control for "viewing only" users
5. **Circuit awareness** — warn if turning on devices would exceed circuit capacity estimate

### Phase 5 Timeline

| Sub-phase | Effort | Deliverable |
|-----------|--------|-------------|
| 5a: Live energy dashboard | 3-5 days | Real-time watts, cost, per-circuit ranking |
| 5b: Device control | 2-3 days | Toggle switches, state display, voice control |
| 5c: Smart insights/alerts | 2-3 days | Capacity warnings, waste detection, anomalies |
| 5d: Historical analytics | 3-5 days | Charts, cost breakdown, comparisons |
| **Phase 5 total** | **~2 weeks** | Full energy monitoring + control layer |

### Prerequisites

- Phase 3b or 3c (HA integration with entity linking)
- HA long-lived access token configured
- Emporia Vue integration working in HA (which you already have)
- Entity mapping: NocoDB circuit records ↔ Emporia Vue sensor entities

---

## Timeline Estimate

| Phase | Effort | Deliverable |
|-------|--------|-------------|
| Phase 1: Open-WebUI Tool | 2-4 hours | AI chat against electrical data via Open-WebUI |
| Phase 1.5: Siri Voice Bridge | 2-4 hours | "Hey Siri, ask electrical..." via LAN |
| Phase 2a: PWA scaffold + NocoDB integration | 2-3 days | Browse/search/edit working on mobile |
| Phase 2b: AI chat panel | 2-3 days | Embedded Ollama chat with tool calling |
| Phase 2c: Polish + PWA features | 2-3 days | Offline, panel view, install-to-homescreen |
| Phase 3a: HA iframe + REST sensors | 2-4 hours | Electrical data visible in HA |
| Phase 3b: Custom HA integration | 1-2 weeks | Circuit entities, services, automations |
| Phase 3c: Entity linking | 2-3 weeks | Bidirectional HA ↔ NocoDB mapping |
| **Phase 4a: Floor plan viewer** | **3-5 days** | Pan/zoom map, markers, tap-to-info, circuit highlight |
| Phase 4a+: AI ↔ Map integration | 1-2 days | Chat triggers highlights, map context in queries |
| Phase 4b: Upload & device placement | 3-5 days | Upload plan, tap-to-place, draw.io import |
| Phase 4c: AR/VR exploration | 4-6 weeks | Native ARKit prototype (stretch) |
| Phase 4c: Import/export | 2-3 days | SVG, PDF, CSV, JSON |
| **Phase 5a: Live energy dashboard** | **3-5 days** | Real-time watts, costs, rankings |
| Phase 5b: Device control | 2-3 days | Toggle Z-Wave devices from app + voice |
| Phase 5c: Smart insights | 2-3 days | Capacity alerts, waste detection |
| Phase 5d: Historical analytics | 3-5 days | Charts, cost breakdown, trends |
| **Total MVP (Phases 1-2c + 3a + 4a)** | **~3 weeks** | Full PWA + Siri + HA + Floor Plan |
| **Total with Energy (add Phase 5)** | **~5 weeks** | + Live monitoring + device control |
