# Energy Integration Design Document

## Overview

This document describes the architecture for integrating live energy monitoring data (Emporia Vue + Enphase Solar via Home Assistant) into the Electrical Config AI PWA. The goal is to bridge static circuit topology (NocoDB) with real-time power telemetry.

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Client (Browser/PWA)                         │
│                                                                      │
│  Energy Dashboard ◄── EventSource (SSE) ◄── /api/energy/live        │
│  History Charts   ◄── fetch()            ◄── /api/energy/history    │
│  Solar Card       ◄── fetch()            ◄── /api/energy/solar      │
│  Settings         ◄── fetch()            ◄── /api/energy/mapping    │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ HTTP
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SvelteKit Server (Node.js)                        │
│                                                                      │
│  ┌──────────────────┐  ┌────────────────────┐  ┌────────────────┐  │
│  │ SSE Fan-out      │  │ HA WebSocket Client │  │ HA REST Client │  │
│  │ (per-client      │◄─┤ (single persistent  │  │ (history,      │  │
│  │  streams)        │  │  connection)        │  │  discovery)    │  │
│  └──────────────────┘  └─────────┬───────────┘  └───────┬────────┘  │
│                                  │                       │           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Entity Mapping Cache (in-memory, refreshed from NocoDB)      │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬───────────────────┬───────────────────┘
                               │                   │
              WebSocket/REST   │                   │ REST
                               ▼                   ▼
                   ┌───────────────────┐   ┌──────────────┐
                   │  Home Assistant   │   │    NocoDB     │
                   │                   │   │              │
                   │ • Emporia Vue     │   │ • Circuits   │
                   │   entities        │   │ • Panels     │
                   │ • Enphase Solar   │   │ • Entity     │
                   │   entities        │   │   mappings   │
                   │ • History API     │   │              │
                   └───────────────────┘   └──────────────┘
```

---

## Home Assistant API Contracts

### Authentication

All HA requests use a **Long-Lived Access Token** (generated in HA user profile):

```
Authorization: Bearer <HA_TOKEN>
```

### REST API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/states` | GET | All entity states |
| `/api/states/<entity_id>` | GET | Single entity state |
| `/api/history/period/<timestamp>` | GET | Historical state changes |
| `/api/services/<domain>/<service>` | POST | Call a service |

#### Get Entity State

```http
GET /api/states/sensor.emporia_vue_circuit_1_power
Authorization: Bearer <token>

Response:
{
  "entity_id": "sensor.emporia_vue_circuit_1_power",
  "state": "1247.3",
  "attributes": {
    "unit_of_measurement": "W",
    "device_class": "power",
    "friendly_name": "Emporia Vue Circuit 1 Power"
  },
  "last_changed": "2026-07-06T20:30:15.123456+00:00",
  "last_updated": "2026-07-06T20:30:15.123456+00:00"
}
```

#### Get History

```http
GET /api/history/period/2026-07-06T00:00:00Z?filter_entity_id=sensor.emporia_vue_circuit_1_power&end_time=2026-07-06T23:59:59Z&minimal_response&significant_changes_only
Authorization: Bearer <token>

Response: [
  [
    { "state": "1247.3", "last_changed": "2026-07-06T20:30:15+00:00" },
    { "state": "1189.1", "last_changed": "2026-07-06T20:31:15+00:00" },
    ...
  ]
]
```

### WebSocket API

Connect to `ws://<HA_URL>/api/websocket`

#### Auth Flow
```json
// Server sends:
{ "type": "auth_required", "ha_version": "2025.1.0" }

// Client sends:
{ "type": "auth", "access_token": "<HA_TOKEN>" }

// Server responds:
{ "type": "auth_ok", "ha_version": "2025.1.0" }
```

#### Subscribe to State Changes
```json
// Client sends:
{ "id": 1, "type": "subscribe_entities", "entity_ids": ["sensor.emporia_vue_circuit_1_power", ...] }

// Server sends updates:
{
  "id": 1,
  "type": "event",
  "event": {
    "a": {  // "a" = additions/changes
      "sensor.emporia_vue_circuit_1_power": {
        "s": "1247.3",  // state
        "lc": 1720296615.123  // last_changed timestamp
      }
    }
  }
}
```

---

## Entity Naming Conventions

### Emporia Vue Entities

Pattern: `sensor.emporia_vue_<location>_<circuit_number>_<measurement>`

Examples:
- `sensor.emporia_vue_circuit_1_power` (watts)
- `sensor.emporia_vue_circuit_1_energy` (kWh cumulative)
- `sensor.emporia_vue_total_power` (whole-home watts)
- `sensor.emporia_vue_balance_power` (unmonitored load)

The exact naming depends on user's HA Emporia integration config. The `HA_EMPORIA_PREFIX` env var allows customization.

### Enphase Solar Entities

- `sensor.enphase_current_power_production` (watts currently producing)
- `sensor.enphase_today_s_energy_production` (Wh produced today)
- `sensor.enphase_lifetime_energy_production` (Wh lifetime)
- `sensor.envoy_<serial>_current_power_production` (alternate naming)

---

## Entity Mapping Strategy

### NocoDB Schema Addition

Add to the **Circuits** table:

| Field | Type | Description |
|-------|------|-------------|
| `ha_energy_entity_id` | SingleLineText | HA entity ID for power monitoring (e.g., `sensor.emporia_vue_circuit_7_power`) |

### Mapping Flow

1. **Auto-discovery**: Server queries HA `/api/states`, filters entities matching `HA_EMPORIA_PREFIX`
2. **Settings UI**: Shows discovered entities alongside NocoDB circuits
3. **User maps**: Drag/select to associate circuit → entity
4. **Persisted**: Mapping saved to NocoDB circuit record's `ha_energy_entity_id` field
5. **Runtime**: Server loads mappings on startup, caches in memory, refreshes every 5 min

### Mapping Cache

```typescript
// In-memory mapping refreshed from NocoDB periodically
interface EntityMapping {
  circuitId: number;
  circuitName: string;
  panelName: string;
  entityId: string;       // HA entity_id
  ampRating: number;      // For capacity % calculation
  voltage: number;        // 120 or 240
}
```

---

## Caching Strategy

| Data Type | Cache | TTL | Reason |
|-----------|-------|-----|--------|
| Live readings | None (SSE stream) | Real-time | Must be current |
| Entity mappings | Server memory | 5 min | Rarely changes, avoid NocoDB spam |
| History (1H) | None | - | Small payload, always fresh |
| History (24H) | Server memory | 5 min | Moderate size, acceptable staleness |
| History (7D/30D) | Server memory | 15 min | Large, rarely changes mid-session |
| HA entity list | Server memory | 10 min | For auto-discovery in settings |
| Solar production | None | - | Always live from SSE |

---

## Server-Sent Events (SSE) Protocol

### `/api/energy/live` Endpoint

Client connects via `EventSource`. Server fans out HA WebSocket updates.

```
event: power
data: {"total":4287,"circuits":[{"id":1,"name":"A/C","watts":2100,"trend":"down"},...],"solar":{"production":3200,"consumption":4287,"net":-1087},"timestamp":"2026-07-06T20:30:15Z"}

event: power
data: {"total":4150,...}
```

Events sent every ~1 second (matching Emporia Vue update frequency).

### Reconnection

- Client `EventSource` auto-reconnects on disconnect
- Server sends `retry: 3000` header (3s reconnect delay)
- On reconnect, server sends full state snapshot immediately

---

## Solar Integration

### Data Points

| Metric | Source Entity | Unit |
|--------|-------------|------|
| Current production | `sensor.enphase_current_power_production` | W |
| Today's production | `sensor.enphase_today_s_energy_production` | Wh |
| Lifetime production | `sensor.enphase_lifetime_energy_production` | Wh |
| Net power | Calculated: consumption - production | W |
| Self-consumption ratio | production used / total production | % |

### Solar Card Logic

```
Net = Total Consumption - Solar Production
If Net > 0: "Importing {Net}W from grid"
If Net < 0: "Exporting {|Net|}W to grid"
If Net ≈ 0: "Self-sufficient"
```

---

## UI Wireframes

### Energy Dashboard (matches `mockups/energy-live.html`)

```
┌─────────────────────────────────────┐
│ Emporia Vue · Live feed    [● Live] │
│ Energy Monitor                      │
│                                     │
│ [Live] [1H] [24H] [7D] [30D]       │
├─────────────────────────────────────┤
│ TOTAL POWER              Rate       │
│ 4,287 W                 $0.138/kWh  │
│ Boynton · Main + Sub                │
│ ┌─────────────────────────────────┐ │
│ │ ~~~~ sparkline chart ~~~~       │ │
│ └─────────────────────────────────┘ │
│ Daily cost estimate    ~$14.20/day  │
├─────────────────────────────────────┤
│ ☀️ SOLAR                            │
│ Producing: 3,200W                   │
│ Net: Importing 1,087W from grid     │
│ Today: 18.4 kWh                     │
├─────────────────────────────────────┤
│ TOP CONSUMERS            6 active   │
│                                     │
│ A/C Condenser      2,100W  ↓  49%  │
│ ████████████████░░░░░░░░░░░░░░░░░  │
│                                     │
│ Pool Pump          1,200W  →  28%  │
│ █████████░░░░░░░░░░░░░░░░░░░░░░░░  │
│                                     │
│ Kitchen (Ckt 7)      340W  ↑   8%  │
│ ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
├─────────────────────────────────────┤
│ CAPACITY ALERTS                     │
│ ⚠️ Circuit 7 at 76% of 20A         │
│ ⚠️ Pool Pump ran 14h continuously   │
└─────────────────────────────────────┘
```

### Entity Mapping Settings

```
┌─────────────────────────────────────┐
│ ← Settings / Energy Mapping         │
├─────────────────────────────────────┤
│ HA Status: ● Connected              │
│ Entities found: 24 Emporia sensors  │
├─────────────────────────────────────┤
│ MAPPED CIRCUITS (8/16)              │
│                                     │
│ Circuit 1 - A/C Condenser           │
│ → sensor.emporia_vue_circuit_1_power│
│                                     │
│ Circuit 7 - Kitchen                  │
│ → sensor.emporia_vue_circuit_7_power│
│                                     │
│ [+ Map More Circuits]               │
├─────────────────────────────────────┤
│ UNMAPPED ENTITIES                   │
│ sensor.emporia_vue_circuit_3_power  │
│ sensor.emporia_vue_circuit_4_power  │
│ [Auto-match by name]               │
└─────────────────────────────────────┘
```

---

## Environment Variables

```env
# Home Assistant
HA_URL=http://homeassistant.example:8123
HA_TOKEN=your_long_lived_access_token

# Emporia Vue entity prefix (used for auto-discovery)
HA_EMPORIA_PREFIX=sensor.emporia_vue_

# Enphase Solar entity
HA_ENPHASE_PRODUCTION_ENTITY=sensor.enphase_current_power_production
HA_ENPHASE_TODAY_ENTITY=sensor.enphase_today_s_energy_production

# Utility rate ($/kWh)
UTILITY_RATE_KWH=0.138
```

---

## Error Handling & Graceful Degradation

| Failure Mode | Behavior |
|-------------|----------|
| HA unreachable | Dashboard shows "HA Offline" badge, cached last-known values displayed grayed out |
| WebSocket disconnects | Auto-reconnect every 3s, fall back to REST polling (5s interval) |
| Entity not found | Circuit shows "No data" instead of watts |
| NocoDB unreachable | Use cached entity mappings, disable mapping settings |
| Invalid HA token | Show auth error in settings, disable energy features |

---

## Capacity Calculations

```
Circuit capacity (watts) = ampRating × voltage
Utilization % = currentWatts / capacityWatts × 100

Warning thresholds:
  - 60% → yellow indicator
  - 80% → orange indicator + alert
  - 90% → red indicator + critical alert
```

For 240V circuits (A/C, dryer, etc.), both legs are measured; watts already reflect full draw.

---

## Future Considerations (Out of Scope)

- Time-of-use rate plans
- Per-panel production (Enphase microinverter-level)
- EV charger integration (load management)
- Device control (Phase 5b)
- Anomaly detection ML (Phase 5c)
- Historical cost comparison analytics (Phase 5d)

---

## Energy Flow Visualization — Architecture Decision

### Decision: Custom SVG with `<animateMotion>` (powerflow.js pattern)

**Date:** 2026-07-07  
**Status:** Accepted

### Context

We need an animated energy flow diagram showing real-time power distribution between Solar → Home → Grid (and future Battery/EV nodes). We evaluated embedding Home Assistant UI components directly, using third-party libraries, and building custom.

### Options Evaluated

| Option | Verdict | Rationale |
|--------|---------|-----------|
| **Embed HA UI (iframe)** | ❌ Rejected | X-Frame-Options blocks it; 4-8MB JS bundle; session cookie issues; terrible mobile perf |
| **Extract HA cards as web components** | ❌ Rejected | `ha-sankey-chart` and `energy-flow-card-plus` depend on `hass.connection._energy` (HA-internal). Only `tesla-style-solar-power-card` is extractable but LitElement conflicts with Svelte |
| **`@xyflow/svelte`** | ⏳ Future | Svelte 5 native, 28k stars, MIT. Overkill for 3-node fixed layout but good for complex topologies (Phase C with battery/EV/multi-inverter). Custom animated edge is ~20 lines |
| **`d3-sankey` + LayerCake** | ⏳ Future | Best for proportional-width energy balance views (not real-time animated flow) |
| **`anime.js` path animation** | 🟡 Alternative | 14KB, good JS control, but `<animateMotion>` is simpler for our use case |
| **Custom SVG `<animateMotion>`** | ✅ Accepted | Zero dependencies, GPU-composited, browser-native. Pattern proven by `powerflow.js` (JoshuaDodds/cerbomoticzgx) |

### Reference Implementation: `JoshuaDodds/cerbomoticzgx:frontend/static/js/powerflow.js`

A zero-dependency, vanilla JS+SVG animated power flow renderer (ISC license, ~30KB). Key patterns adopted:

1. **Topology as data** — edges defined as `{ key, a, b, color }` array
2. **Speed scaled by power** — `durFor(mag)`: <300W → 3.6s, <1500W → 3.0s, <5000W → 2.4s, else 1.8s
3. **Direction via `keyPoints`** — `"0;1"` = forward, `"1;0"` = reverse (no path rebuild needed)
4. **Staggered dots** — `begin="-i * dur/count"` (negative begin = phase offset)
5. **Visibility threshold** — dots hidden when |watts| < 15 (avoids jitter at near-zero)
6. **Auto port routing** — cubic bezier `M...C...` from port attachment points on nodes
7. **Source color mixing** — `decompose()` splits power by provenance (solar vs grid vs battery)

### Implementation

Our `EnergyFlowDiagram.svelte` uses this exact pattern in Svelte 5:
- `$derived` for speed/direction/dot-count (reactive to prop changes)
- Pure SVG in a single viewBox (no mixed HTML/SVG coordinate systems)
- `<animateMotion>` with `calcMode="linear"` and `keyPoints`/`keyTimes`
- Glow via `<filter>` with `feGaussianBlur`

### Future Evolution Path

| When | Action |
|------|--------|
| Battery/EV added | Add nodes + edges to topology array; adopt `decompose()` for source-color mixing |
| Complex topology (>5 nodes) | Migrate to `@xyflow/svelte` with custom `EnergyEdge.svelte` |
| Energy balance summary | Add `d3-sankey` + LayerCake for a separate Sankey breakdown view |
| HA data enrichment | Use `home-assistant-js-websocket` (official, 0-dep) for real-time entity subscriptions; already connected via our server-side WS bridge |

### Key Libraries for Future Reference

| Library | Use Case | Stars | Bundle |
|---------|----------|-------|--------|
| `@xyflow/svelte` | Node graph with custom animated edges | 28k | ~60KB |
| `d3-sankey` | Proportional flow width layouts | 928 | ~5KB |
| `layercake` | Svelte viz framework (wraps D3) | 1.8k | ~8KB |
| `anime.js` | JS-controlled path animation | 50k | 14KB |
| `home-assistant-js-websocket` | Official HA real-time API client | — | ~3KB |
