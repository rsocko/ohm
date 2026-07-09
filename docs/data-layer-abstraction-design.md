# Data Layer Abstraction Design Document

> Last updated: 2026-07-07

## Overview

This document evaluates whether to migrate from NocoDB to a local/embedded datastore (SQLite or similar), proposes an abstraction layer strategy, and outlines how a custom datastore enables a domain-specific MCP server that surpasses the generic NocoDB MCP.

---

## Current State

### Architecture

```
┌─────────────────────────────────────┐
│         SvelteKit PWA               │
│                                     │
│  nocodb.ts (thin REST wrapper)      │
│  ~15 import sites across:           │
│  • energy-mappings.ts               │
│  • api/nocodb/+server.ts            │
│  • api/chat/+server.ts              │
│  • api/unifi/sync/+server.ts        │
│  • api/unifi/discovery/+server.ts   │
│  • api/upload/+server.ts            │
│  • api/geocode/+server.ts           │
└──────────────┬──────────────────────┘
               │ HTTP REST (xc-token auth)
               ▼
┌─────────────────────────────────────┐
│           NocoDB                     │
│                                     │
│  Tables: Areas, Panels, Circuits,   │
│  Receptacles, Loads                 │
│  + linked records, file storage     │
│  + built-in MCP server              │
└─────────────────────────────────────┘
```

### What NocoDB Provides Today

| Capability | Value to You (Developer/Curator) | Value to End-Users |
|------------|----------------------------------|-------------------|
| Spreadsheet grid UI for data entry | 🟢 High — primary data authoring tool | ⚪ None |
| REST API with filtering/pagination | 🟡 Medium — app wraps it anyway | ⚪ None (invisible) |
| Linked records / relational views | 🟡 Medium — convenient but simple joins | ⚪ None |
| Schema flexibility (add columns) | 🟡 Medium — no migration tooling needed | ⚪ None |
| Built-in MCP server | 🟡 Medium — generic table CRUD operations | 🟡 Limited (see below) |
| File attachment storage | 🟡 Medium — used for panel photos | 🟡 Low |
| Audit trail | 🟡 Medium — record-level change history | ⚪ None |

**Key insight:** NocoDB's value is overwhelmingly to *you as the data curator*, not to consumers of the app.

---

## The MCP Argument: Generic vs. Domain-Specific

### Current State: NocoDB's Generic MCP

The NocoDB MCP server exposes generic table operations:

```
Tools available:
• list_tables() → ["Areas", "Panels", "Circuits", "Receptacles", "Loads"]
• query_records(table, filter) → raw field bags
• create_record(table, fields) → new record
• update_record(table, id, fields) → updated record
```

**Limitations:**
- AI must understand NocoDB's schema to form useful queries
- No domain semantics — "what's on circuit 7?" requires the AI to know which table to query, what fields link circuits to loads, and how to join them
- No compound operations — "move outlet to different circuit" is multi-step
- No awareness of electrical domain constraints (amp ratings, voltage, GFCI requirements)
- No integration with live data (energy readings, HA entities, UniFi devices)

### Future State: Domain-Specific MCP

With our own datastore, we control the MCP surface entirely. We can expose **intent-level operations** rather than CRUD:

```
Tools available:
• what_is_on_circuit(circuit_number, panel?) → loads, receptacles, total amps, capacity %
• find_outlet(location_description) → matching receptacles with circuit info
• get_circuit_load_analysis(circuit_id) → current draw, capacity, connected devices, HA entities
• move_device_to_circuit(device_id, target_circuit_id) → validates capacity, updates links
• get_room_electrical_summary(room_name) → all circuits, outlets, devices, power usage
• suggest_circuit_for_new_load(amps, voltage, location) → recommends circuit with headroom
• get_energy_snapshot(scope: "home"|"panel"|"circuit") → live + historical power data
• get_panel_directory(panel_id) → formatted breaker schedule
• validate_circuit_capacity(circuit_id, additional_amps) → safety check
• find_gfci_protection_gaps() → outlets that should be GFCI but aren't
• get_maintenance_checklist(area?) → AFCI test dates, GFCI statuses, label freshness
```

### Why This Is Dramatically Better

| Dimension | NocoDB Generic MCP | Custom Domain MCP |
|-----------|-------------------|-------------------|
| **Query complexity** | AI must compose multi-table joins | Single intent-level call |
| **Domain safety** | AI can write invalid data | Operations enforce electrical constraints |
| **Compound operations** | Multiple round-trips, no atomicity | Single atomic tool call |
| **Cross-system fusion** | Separate NocoDB + HA + UniFi calls | One tool returns fused data |
| **Discoverability** | Tool names are generic CRUD | Tool names teach the AI the domain |
| **Error quality** | "Record not found" | "Circuit 7 is at 92% capacity — cannot add 15A load" |
| **Offline AI** | Requires NocoDB network access | SQLite is in-process, works locally |

### MCP Implementation Sketch

```typescript
// src/lib/server/mcp/electrical-mcp.ts

export const tools = {
  what_is_on_circuit: {
    description: "Get all loads, receptacles, and devices on a specific circuit with capacity analysis",
    parameters: { circuit_number: "number", panel_name: "string?" },
    handler: async ({ circuit_number, panel_name }) => {
      const circuit = await db.circuits.findByNumber(circuit_number, panel_name);
      const loads = await db.loads.forCircuit(circuit.id);
      const receptacles = await db.receptacles.forCircuit(circuit.id);
      const energy = await energyService.currentDraw(circuit.id);
      return {
        circuit: { name: circuit.name, amps: circuit.ampRating, voltage: circuit.voltage },
        loads: loads.map(l => ({ name: l.name, type: l.type, estimatedWatts: l.watts })),
        receptacles: receptacles.map(r => ({ location: r.location, type: r.outletType })),
        capacity: {
          ratedWatts: circuit.ampRating * circuit.voltage,
          currentDraw: energy?.watts ?? null,
          utilization: energy ? (energy.watts / (circuit.ampRating * circuit.voltage)) * 100 : null
        }
      };
    }
  },
  
  suggest_circuit_for_new_load: {
    description: "Find the best circuit for a new electrical load based on capacity, location, and safety",
    parameters: { amps: "number", voltage: "number", location: "string", requires_gfci: "boolean?" },
    handler: async ({ amps, voltage, location, requires_gfci }) => {
      // Domain logic: find circuits in/near location with sufficient headroom
      // Factor in NEC 80% continuous load rule
      // Check GFCI/AFCI requirements
      // Return ranked suggestions with reasoning
    }
  }
};
```

---

## Abstraction Layer Design

### Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SvelteKit PWA                              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              Domain Services Layer                      │  │
│  │  circuit-service.ts | room-service.ts | panel-service  │  │
│  │  energy-service.ts  | search-service.ts                │  │
│  └────────────────────────┬───────────────────────────────┘  │
│                           │                                   │
│  ┌────────────────────────┴───────────────────────────────┐  │
│  │           DataProvider Interface                        │  │
│  │                                                        │  │
│  │  getCircuits(filter?) → Circuit[]                      │  │
│  │  getCircuitWithLoads(id) → CircuitDetail               │  │
│  │  getPanel(id) → Panel                                  │  │
│  │  getRoomsForArea(areaId) → Room[]                      │  │
│  │  updateCircuit(id, fields) → void                      │  │
│  │  createLoad(circuitId, data) → Load                    │  │
│  │  searchAll(query) → SearchResult[]                     │  │
│  │  uploadAttachment(file) → Attachment                   │  │
│  └──────────┬─────────────────────────┬───────────────────┘  │
│             │                         │                       │
│  ┌──────────┴──────────┐   ┌─────────┴────────────┐         │
│  │  NocoDB Provider    │   │  SQLite Provider     │         │
│  │  (nocodb.ts today)  │   │  (better-sqlite3 or  │         │
│  │                     │   │   libsql/turso)      │         │
│  └──────────┬──────────┘   └─────────┬────────────┘         │
└─────────────┼─────────────────────────┼───────────────────────┘
              │                         │
              ▼                         ▼
    ┌──────────────┐          ┌────────────────┐
    │   NocoDB     │          │  SQLite file   │
    │   (remote)   │          │  (in-process)  │
    └──────────────┘          └────────────────┘
```

### Interface Design (Not a Full ORM)

```typescript
// src/lib/server/db/provider.ts

export interface DataProvider {
  // Core CRUD
  getCircuits(filter?: CircuitFilter): Promise<Circuit[]>;
  getCircuit(id: number): Promise<Circuit | null>;
  createCircuit(data: CircuitCreate): Promise<Circuit>;
  updateCircuit(id: number, data: Partial<CircuitCreate>): Promise<void>;
  deleteCircuit(id: number): Promise<void>;

  getPanels(): Promise<Panel[]>;
  getPanel(id: number): Promise<Panel | null>;

  getRooms(areaId?: number): Promise<Room[]>;
  getLoadsForCircuit(circuitId: number): Promise<Load[]>;
  getReceptaclesForCircuit(circuitId: number): Promise<Receptacle[]>;

  // Relationships
  linkLoadToCircuit(loadId: number, circuitId: number): Promise<void>;
  unlinkLoad(loadId: number): Promise<void>;

  // Search
  searchAll(query: string): Promise<SearchResult[]>;

  // Files
  uploadFile(file: Buffer, filename: string, mimetype: string): Promise<Attachment>;

  // Metadata
  getSchemaVersion(): Promise<number>;
}
```

### Why Not Prisma/Drizzle/Full ORM?

| Reason | Explanation |
|--------|-------------|
| NocoDB returns schemaless `fields` bags | ORMs expect typed columns; our data is `Record<string, unknown>` |
| Linked records vary by API version | V2 vs V3 return different shapes — we normalize in the provider |
| We need provider swappability | ORMs bind to a single DB; we want NocoDB *or* SQLite behind one interface |
| Small surface area | ~8-10 methods total — doesn't justify ORM complexity |
| Domain layer does the heavy lifting | Joins, validation, and business logic live above the provider |

---

## SQLite Provider Design (Future)

### Technology Choice

| Option | Pros | Cons |
|--------|------|------|
| **better-sqlite3** | Synchronous, fastest, battle-tested | Native binary (needs rebuild per platform) |
| **libSQL (Turso)** | SQLite-compatible, optional remote sync | Newer, less ecosystem |
| **sql.js (WASM)** | No native deps, works everywhere | Slower, entire DB in memory |
| **Drizzle + SQLite** | Type-safe queries, migration tooling | More abstraction than we need |

**Recommendation:** `better-sqlite3` for the server provider (Node.js, fast, synchronous reads), with a potential `sql.js` path for client-side offline in the future.

### Schema Design

```sql
-- Core entities
CREATE TABLE areas (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  property TEXT NOT NULL,  -- "Boynton", "Tequesta"
  floor TEXT,
  notes TEXT
);

CREATE TABLE panels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  area_id INTEGER REFERENCES areas(id),
  type TEXT,  -- "Main", "Sub"
  total_amps INTEGER,
  voltage INTEGER DEFAULT 240,
  notes TEXT
);

CREATE TABLE circuits (
  id INTEGER PRIMARY KEY,
  panel_id INTEGER REFERENCES panels(id),
  number INTEGER NOT NULL,
  name TEXT NOT NULL,
  amp_rating INTEGER DEFAULT 20,
  voltage INTEGER DEFAULT 120,
  breaker_type TEXT,  -- "Standard", "GFCI", "AFCI", "Dual"
  ha_power_entity_id TEXT,
  ha_energy_entity_id TEXT,
  notes TEXT,
  UNIQUE(panel_id, number)
);

CREATE TABLE receptacles (
  id INTEGER PRIMARY KEY,
  circuit_id INTEGER REFERENCES circuits(id),
  area_id INTEGER REFERENCES areas(id),
  location TEXT NOT NULL,
  outlet_type TEXT,  -- "Standard", "GFCI", "USB", "240V"
  gang_size INTEGER DEFAULT 1,
  notes TEXT
);

CREATE TABLE loads (
  id INTEGER PRIMARY KEY,
  circuit_id INTEGER REFERENCES circuits(id),
  name TEXT NOT NULL,
  type TEXT,  -- "Lighting", "Appliance", "HVAC", "Motor"
  estimated_watts INTEGER,
  always_on BOOLEAN DEFAULT FALSE,
  notes TEXT
);

-- Network integration
CREATE TABLE network_devices (
  id INTEGER PRIMARY KEY,
  circuit_id INTEGER REFERENCES circuits(id),
  mac_address TEXT UNIQUE,
  name TEXT,
  device_type TEXT,
  power_source TEXT,  -- "POE", "AC", "Battery"
  unifi_role TEXT,
  last_synced_at TEXT
);

-- File attachments
CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,  -- "panel", "circuit", "receptacle"
  entity_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mimetype TEXT NOT NULL,
  path TEXT NOT NULL,  -- local file path
  created_at TEXT DEFAULT (datetime('now'))
);

-- Schema versioning
CREATE TABLE schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
INSERT INTO schema_meta (key, value) VALUES ('version', '1');
```

### Migration from NocoDB

```typescript
// scripts/migrate-from-nocodb.ts
// One-time export: NocoDB API → SQLite seed

async function migrate() {
  const tables = await nocodb.listTables();
  for (const table of tables) {
    const records = await nocodb.getRecords(table.id, { limit: '1000' });
    // Transform V3Record fields → typed SQLite rows
    // Resolve linked records → foreign keys
    // Download attachments → local /data/attachments/
  }
}
```

---

## Domain MCP Server: Phased Design

### Phase 1: Read-Only Domain Tools (alongside NocoDB)

Expose domain-level queries that compose data from the provider layer. Works with *either* backend.

```
Tools:
• what_is_on_circuit(number, panel?)
• find_outlet(description)
• get_panel_directory(panel_name)
• get_room_summary(room_name)
• search_electrical(query)
• get_circuit_capacity(circuit_id)
```

### Phase 2: Write Operations with Validation

Add mutation tools with electrical domain constraints.

```
Tools:
• add_load_to_circuit(circuit_id, load_data) — validates capacity
• move_load(load_id, target_circuit_id) — checks amps, voltage match
• update_outlet_type(receptacle_id, new_type) — enforces GFCI rules for wet locations
• mark_circuit_breaker_type(circuit_id, type) — validates panel compatibility
```

### Phase 3: Cross-System Fusion Tools

Combine electrical data with live telemetry.

```
Tools:
• get_energy_snapshot(scope) — fuses NocoDB topology + HA live readings
• check_circuit_health(circuit_id) — load analysis + live draw + anomaly detection
• find_energy_waste() — circuits with draw but no expected load
• network_power_audit() — POE budget + circuit capacity cross-reference
• get_maintenance_due() — GFCI test dates, label age, calibration freshness
```

### Phase 4: Proactive / Advisory Tools

AI-initiated recommendations.

```
Tools:
• suggest_circuit_for_load(amps, voltage, location, gfci_required?)
• find_gfci_gaps() — wet-location outlets without GFCI protection
• capacity_forecast(circuit_id, planned_additions[]) — "will this trip?"
• generate_panel_schedule(panel_id, format) — NEC-compliant breaker schedule
```

---

## Implementation Phases & Timeline

### Phase 0: Extract Provider Interface (Now — 2-4 hours)

**Goal:** Create the abstraction seam with zero behavioral change.

- [ ] Define `DataProvider` interface in `src/lib/server/db/provider.ts`
- [ ] Define typed domain models (`Circuit`, `Panel`, `Room`, `Load`, `Receptacle`)
- [ ] Wrap existing `nocodb.ts` functions into a `NocoDBProvider` class
- [ ] Create `src/lib/server/db/index.ts` that exports the active provider
- [ ] Update all ~15 import sites to use the provider interface
- [ ] Verify app works identically

### Phase 1: Domain MCP Server — Read-Only (1-2 weeks)

**Goal:** AI chat uses domain-specific tools instead of generic NocoDB MCP.

- [ ] Build MCP server (Node.js, `@modelcontextprotocol/sdk`)
- [ ] Implement 6 read-only domain tools
- [ ] Register with Open-WebUI as tool server (replace NocoDB MCP)
- [ ] Test with Ollama models — compare query accuracy vs. generic MCP

**Success metric:** AI correctly answers "what's on circuit 7?" in one tool call (vs. current multi-step NocoDB queries).

### Phase 2: SQLite Provider (1 week)

**Goal:** App can run without NocoDB.

- [ ] Implement `SQLiteProvider` behind `DataProvider` interface
- [ ] Build migration script (NocoDB → SQLite seed)
- [ ] Add `DB_PROVIDER=sqlite|nocodb` env var switching
- [ ] Local file storage for attachments (`/data/attachments/`)
- [ ] Verify all app features work with SQLite backend
- [ ] Add basic admin CRUD pages (replace NocoDB grid UI for SQLite users)

### Phase 3: Domain MCP — Writes + Fusion (2-3 weeks)

**Goal:** AI can safely mutate data and query across systems.

- [ ] Add write tools with validation and confirmation flow
- [ ] Fuse energy telemetry into MCP responses
- [ ] Add UniFi network data to relevant queries
- [ ] Build MCP test suite (domain constraint enforcement)

### Phase 4: Open-Source Preparation (1-2 weeks)

**Goal:** App is self-contained and deployable by others.

- [ ] SQLite as default provider (NocoDB opt-in for power users)
- [ ] First-run setup wizard (guided DB seeding)
- [ ] Sample dataset for demo/testing
- [ ] Docker image: single container, SQLite embedded, no external deps required
- [ ] Document: "Adding your own home" guide
- [ ] MCP server packaged as installable tool for any MCP-compatible client

---

## Decision Matrix: When to Use Which Provider

| Scenario | Recommended Provider | Rationale |
|----------|---------------------|-----------|
| Ryan's personal homelab | NocoDB | Grid UI for data curation, existing workflow |
| Open-source user, single home | SQLite | Zero external deps, instant setup |
| Multi-user household | SQLite + app CRUD | Don't require everyone to learn NocoDB |
| Power user with existing NocoDB | NocoDB | Preserve their tooling investment |
| Offline/mobile-first deployment | SQLite | No network dependency for core reads |
| CI/testing | SQLite (in-memory) | Fast, isolated, deterministic |

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Migration corrupts relational links | Build validator that compares NocoDB export vs SQLite state |
| Lose NocoDB grid UI before app CRUD is ready | Keep NocoDB provider indefinitely; don't deprecate |
| Custom MCP is harder than expected | Phase 1 is read-only — low risk, high learning |
| SQLite concurrency under heavy writes | App is single-user; WAL mode handles concurrent reads trivially |
| Attachment storage management | Simple `/data/attachments/{entity_type}/{id}/` structure with cleanup on delete |
| Schema migrations become our problem | Use a version table + numbered migration scripts (simple, no ORM needed) |

---

## Open Questions

1. **Should the MCP server be embedded in the SvelteKit app or a standalone process?**
   - Embedded: simpler deployment, shared DB connection
   - Standalone: reusable by other MCP clients (Claude Desktop, Cursor, etc.)
   - **Leaning:** Standalone process, Docker sidecar — maximizes reusability

2. **Should we support both providers simultaneously (NocoDB as remote + SQLite as local cache)?**
   - Could enable: NocoDB as source-of-truth, SQLite as read cache for offline
   - Adds sync complexity — probably not worth it unless offline is critical

3. **What's the minimum admin UI needed before SQLite is viable for new users?**
   - Table views for: Panels, Circuits, Loads, Receptacles
   - Inline editing, create/delete
   - Bulk import from CSV (for users migrating from spreadsheets)

---

## Summary

The path forward is:

1. **Extract the interface now** — cheap, zero-risk, creates the seam
2. **Build the domain MCP regardless of DB choice** — this is the highest-value change for AI interaction quality
3. **Build SQLite provider when open-source prep begins** — self-contained deployment is the #1 adoption unlock
4. **Keep NocoDB forever as an option** — it's your power-user data curation tool

The MCP story alone justifies this investment: a domain-specific MCP with operations like `what_is_on_circuit` and `suggest_circuit_for_new_load` is categorically better than generic `query_records("Circuits", filter)` — both for AI accuracy and for the kinds of questions users actually ask while standing at a breaker panel.
