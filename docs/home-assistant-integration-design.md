# Home Assistant Integration — Design Document

## Overview

This document defines the integration between the Electrical Config AI PWA and Home Assistant (HA). The integration enables live energy monitoring, device control, and bidirectional data sync between NocoDB's electrical topology and HA's smart home entities.

### Goals

1. Surface live HA entity states (power draw, on/off) within the PWA UI
2. Create first-class HA entities from NocoDB circuit data
3. Enable device control from the PWA via HA service calls
4. Maintain graceful degradation — PWA works standalone without HA

### Non-Goals (for now)

- HA Add-on packaging (custom integration only)
- Multi-instance HA support
- Cloud/remote HA access (LAN-only)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (PWA)                                 │
│                                                                       │
│  Settings Page ──► Test HA Connection                                │
│  Circuit View  ──► Live power draw, device states                    │
│  Device Cards  ──► Toggle on/off controls                            │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ HTTP / SSE
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SvelteKit Server                                    │
│                                                                       │
│  /api/ha/              ── Connection test, config                     │
│  /api/ha/entities      ── Proxy entity states from HA REST           │
│  /api/ha/control       ── Forward service calls to HA                │
│  /api/ha/subscribe     ── SSE stream (server subscribes via WS)      │
│                                                                       │
│  lib/server/ha-client  ── REST + WebSocket client, token auth        │
└────────────┬──────────────────────────────────┬──────────────────────┘
             │ REST API                         │ WebSocket
             ▼                                  ▼
     ┌──────────────┐                  ┌──────────────────┐
     │   NocoDB     │                  │  Home Assistant   │
     │              │◄─────────────────│                   │
     │  Circuits    │  REST sensors    │  Emporia Vue      │
     │  Loads       │  rest_commands   │  Z-Wave devices   │
     │  Receptacles │                  │  Areas            │
     └──────────────┘                  └──────────────────┘
```

### Data Flow

| Direction | Mechanism | Data |
|-----------|-----------|------|
| HA → PWA | REST API (polled) | Entity states, attributes, areas |
| HA → PWA | WebSocket → SSE | Real-time state changes |
| PWA → HA | REST API (service calls) | Device control, scene activation |
| NocoDB → HA | REST sensors (HA polls PWA) | Circuit metadata as HA entities |
| HA → NocoDB | rest_commands (automations) | Status updates, event logging |

---

## Phase 3a: REST Integration (PWA → HA)

### Authentication

**Decision: Long-lived access token**

| Option | Pros | Cons |
|--------|------|------|
| Long-lived token | Simple, no expiry, LAN-only risk is low | Token in .env file, must protect |
| OAuth2 | Standard, revocable | Complex flow, overkill for single-user homelab |

Generate token in HA: Profile → Long-Lived Access Tokens → Create Token

### Environment Configuration

```env
# .env (PWA server)
HA_URL=http://homeassistant.local:8123
HA_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
HA_ENABLED=true
```

### PWA Server Routes

#### `GET /api/ha` — Connection Test

```typescript
// Returns HA connection status and basic info
Response: {
  connected: boolean;
  version: string;        // HA version
  location_name: string;  // "Home"
  entity_count: number;
}
```

#### `GET /api/ha/entities` — Entity States

```typescript
// Query params: domain, area_id, entity_ids (comma-separated)
Request: GET /api/ha/entities?domain=sensor&area_id=kitchen
Response: {
  entities: Array<{
    entity_id: string;      // "sensor.emporia_vue_circuit_1_power"
    state: string;          // "342.5"
    attributes: Record<string, any>;
    last_changed: string;   // ISO timestamp
  }>;
}
```

#### `POST /api/ha/control` — Device Control

```typescript
Request: {
  entity_id: string;  // "switch.kitchen_island_outlet"
  action: "turn_on" | "turn_off" | "toggle";
  data?: Record<string, any>;  // optional service data
}
Response: {
  success: boolean;
  new_state?: string;
}
```

### HA-Side Configuration (Phase 3a)

```yaml
# configuration.yaml additions
panel_iframe:
  electrical:
    title: "Electrical Config"
    url: "http://electrical.local:3000"
    icon: "mdi:flash"
    require_admin: false

rest:
  - resource: "http://electrical.local:3000/api/query"
    method: POST
    headers:
      Content-Type: "application/json"
    payload: '{"query": "SELECT * FROM Circuits"}'
    scan_interval: 300
    sensor:
      - name: "Total Circuits"
        value_template: "{{ value_json.data | length }}"
      - name: "GFCI Circuits"
        value_template: "{{ value_json.data | selectattr('breaker_type', 'eq', 'GFCI') | list | length }}"

rest_command:
  update_circuit_status:
    url: "http://nocodb.local:8080/api/v2/meta/bases/{{ base_id }}/tables/Circuits/records/{{ record_id }}"
    method: PATCH
    headers:
      xc-auth: !secret nocodb_token
      Content-Type: "application/json"
    payload: '{{ payload }}'
```

---

## Phase 3b: Custom HA Integration

### Integration Structure

```
ha-integration/
└── custom_components/
    └── nocodb_electrical/
        ├── __init__.py          # Integration setup
        ├── manifest.json        # HACS metadata
        ├── const.py             # Constants
        ├── config_flow.py       # UI configuration
        ├── sensor.py            # Circuit sensor entities
        ├── binary_sensor.py     # GFCI/AFCI status (future)
        ├── services.yaml        # Service definitions
        └── strings.json         # UI strings (future)
```

### Entity Model

| NocoDB Table | HA Entity Type | Entity ID Pattern | State Value |
|-------------|---------------|-------------------|-------------|
| Circuits | `sensor` | `sensor.circuit_{panel}_{number}` | Load count |
| Circuits (GFCI) | `binary_sensor` | `binary_sensor.circuit_{panel}_{number}_gfci` | on/off (protected) |
| Panels | `sensor` | `sensor.panel_{name}_utilization` | Percentage used |

### Entity Attributes (Circuit Sensor)

```python
{
    "panel": "Main Panel",
    "circuit_number": 7,
    "breaker_amps": 20,
    "breaker_type": "GFCI",        # GFCI, AFCI, Standard, Tandem
    "area": "Kitchen",
    "loads_count": 4,
    "wire_gauge": "12 AWG",
    "description": "Kitchen Counter - GFCI",
    "nocodb_record_id": "rec_abc123",
}
```

### Services

#### `nocodb_electrical.query`

Execute a read query against NocoDB and return results.

```yaml
# services.yaml
query:
  name: Query NocoDB
  description: Execute a query against the electrical database
  fields:
    table:
      name: Table
      description: NocoDB table to query
      required: true
      example: "Circuits"
      selector:
        select:
          options:
            - "Circuits"
            - "Loads"
            - "Receptacles"
            - "Areas"
            - "Panels"
    filter:
      name: Filter
      description: NocoDB filter expression
      required: false
      example: "(breaker_type,eq,GFCI)"
```

#### `nocodb_electrical.update_record`

Update a record in NocoDB.

```yaml
update_record:
  name: Update Record
  description: Update a record in the electrical database
  fields:
    table:
      name: Table
      required: true
    record_id:
      name: Record ID
      required: true
    data:
      name: Data
      description: JSON object of fields to update
      required: true
```

### Config Flow

```
User installs integration → Config UI asks for:
  1. NocoDB URL (e.g., http://nocodb.local:8080)
  2. NocoDB API Token
  3. Base ID (from NocoDB URL)
  4. Scan interval (default: 300s)
→ Integration tests connection
→ Creates entities for all circuits
→ Links to HA areas by matching NocoDB area names
```

---

## Phase 3c: Bidirectional Entity Linking

### Concept

Add `ha_entity_id` field to NocoDB Loads and Receptacles tables, creating explicit links:

```
NocoDB Load: "Kitchen Pendant Light" (Circuit 7, 20A)
    ↕ ha_entity_id = "light.kitchen_pendant"
HA Entity: light.kitchen_pendant (Z-Wave, dimmable)
```

### NocoDB Schema Changes

```sql
-- Add to Loads table
ALTER TABLE Loads ADD COLUMN ha_entity_id VARCHAR(255);
ALTER TABLE Loads ADD COLUMN ha_last_state VARCHAR(50);
ALTER TABLE Loads ADD COLUMN ha_last_seen TIMESTAMP;

-- Add to Receptacles table  
ALTER TABLE Receptacles ADD COLUMN ha_entity_id VARCHAR(255);
```

### Sync Mechanism

```
┌─────────┐    WebSocket     ┌─────────────┐    REST     ┌─────────┐
│   HA    │ ──state_changed──►│  PWA Server │ ──PATCH────►│ NocoDB  │
│         │                   │             │             │         │
│         │◄──service_call────│             │◄──webhook───│         │
└─────────┘                   └─────────────┘             └─────────┘
```

1. **HA → NocoDB**: PWA server subscribes to state changes for linked entities; updates `ha_last_state` in NocoDB
2. **NocoDB → HA**: When a linked entity's record is updated in NocoDB, fire HA service call (future: NocoDB webhooks)
3. **PWA UI**: Shows live state inline with circuit/load data

### WebSocket Subscription (Server-Side)

```typescript
// Subscribe to state changes for all linked entities
const linkedEntities = await getLinkedEntityIds(); // from NocoDB

haWebSocket.subscribe('state_changed', (event) => {
  if (linkedEntities.includes(event.entity_id)) {
    // Update NocoDB record
    await updateNocoDBState(event.entity_id, event.new_state);
    // Push to connected PWA clients via SSE
    sseClients.broadcast({ entity_id: event.entity_id, state: event.new_state });
  }
});
```

### Control Flow (PWA → HA)

```typescript
// POST /api/ha/control
// 1. Verify entity is linked in NocoDB
// 2. Check safety rules (circuit capacity)
// 3. Call HA service
// 4. Log action to audit table
// 5. Return new state
```

### Safety Rules

| Rule | Trigger | Action |
|------|---------|--------|
| Capacity warning | Turning on device would exceed 80% circuit capacity | Warn user, require confirmation |
| Rapid toggle protection | >3 toggles in 10 seconds | Block, show cooldown |
| Read-only mode | Config flag set | Disable all control buttons |
| Audit logging | Every control action | Log to NocoDB `ControlLog` table |

---

## Graceful Degradation

The PWA must work without HA. Strategy:

| HA Status | PWA Behavior |
|-----------|-------------|
| Connected | Full features: live states, control buttons, energy data |
| Disconnected | Static mode: circuit data from NocoDB only, "HA Offline" badge |
| Never configured | No HA UI elements shown, settings page prompts setup |
| Partial (some entities unavailable) | Show "unavailable" per-entity, rest works |

### Implementation

```typescript
// ha-client.ts
export class HAClient {
  private connected = false;
  private reconnectTimer: NodeJS.Timer | null = null;

  async connect(): Promise<boolean> {
    try {
      const resp = await fetch(`${HA_URL}/api/`, { headers: authHeaders });
      this.connected = resp.ok;
      return this.connected;
    } catch {
      this.connected = false;
      this.scheduleReconnect();
      return false;
    }
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => this.connect(), 30_000);
  }
}
```

---

## Deployment

### Phase 3a (Minimal)

1. Add env vars to PWA deployment
2. Copy `ha-config/configuration.yaml.example` snippets to HA config
3. Restart HA
4. Test iframe panel appears

### Phase 3b (Custom Integration)

**Option A: HACS (Recommended)**

1. Add `ha-integration/` as a GitHub repo or subfolder
2. User adds as custom repository in HACS
3. Install, configure via UI

**Option B: Manual**

1. Copy `custom_components/nocodb_electrical/` to HA's `config/custom_components/`
2. Restart HA
3. Add integration via Settings → Integrations

### Phase 3c

1. Add `ha_entity_id` fields to NocoDB tables (manual or via migration script)
2. Map entities in PWA settings UI
3. WebSocket subscription starts automatically

---

## API Reference Summary

### PWA → HA (proxied through SvelteKit server)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ha` | GET | Connection status |
| `/api/ha/entities` | GET | Fetch entity states |
| `/api/ha/entities?entity_id=X` | GET | Single entity |
| `/api/ha/control` | POST | Call HA service |
| `/api/ha/subscribe` | GET (SSE) | Real-time state stream |
| `/api/ha/areas` | GET | List HA areas |
| `/api/ha/services` | GET | List available services |

### HA → PWA (HA polls or calls)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/query` | POST | HA REST sensor data source |
| `/api/ha/webhook` | POST | NocoDB change notifications (future) |

### Custom Integration Services

| Service | Purpose |
|---------|---------|
| `nocodb_electrical.query` | Read data from NocoDB |
| `nocodb_electrical.update_record` | Write data to NocoDB |
| `nocodb_electrical.sync` | Force full sync |
| `nocodb_electrical.link_entity` | Link HA entity to NocoDB record |

---

## Configuration Reference

### Environment Variables (PWA)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HA_URL` | Yes (if enabled) | — | Home Assistant URL |
| `HA_TOKEN` | Yes (if enabled) | — | Long-lived access token |
| `HA_ENABLED` | No | `false` | Enable HA integration |
| `HA_WS_RECONNECT_INTERVAL` | No | `30000` | WebSocket reconnect interval (ms) |
| `HA_POLL_INTERVAL` | No | `60000` | REST polling fallback interval (ms) |

### HA Secrets (secrets.yaml)

```yaml
nocodb_token: "YOUR_NOCODB_API_TOKEN"
nocodb_base_id: "nc2mrkpyv6f2apa8"
```

---

## Future Considerations

- **Energy cost tracking**: Pull utility rates, calculate per-circuit costs
- **Automation templates**: Pre-built automations for common scenarios (trip detection, capacity alerts)
- **Voice assistant integration**: "Hey Siri, what circuit is the kitchen on?" via Siri Shortcuts → PWA → NocoDB
- **Multi-panel dashboard**: Lovelace card showing panel utilization with per-circuit bars

---

## Phase 3d: Device Unification Layer ↔ HA (Future)

The PWA now maintains a **Device Unification Layer** that cross-links devices across NocoDB, UniFi, and HA using match keys (`Network_Match_Key` for MAC, `HA_Device_Id` for HA device registry). This inventory can be exposed back to HA for richer automations and dashboards.

### What HA Can Leverage

| Data from PWA | HA Use Case |
|---|---|
| Circuit assignment per device | "When circuit trips → notify about all affected devices" |
| Breaker rating + load count | "Warn if circuit utilization exceeds 80% based on known loads" |
| Room ↔ device ↔ circuit mapping | Auto-populate HA areas from NocoDB room assignments |
| Network topology (switch/port) | "Alert if POE device loses power" (cross-reference HA + UniFi) |
| Device category taxonomy | Auto-group HA entities by electrical category |
| Homebox warranty/purchase data | "Alert when device warranty expires" |
| Floorplan coordinates | HA picture-elements card auto-positioning |

### Implementation Options

#### Option A: REST Sensor Platform (Simple)
Expose a `/api/ha/devices/enriched` endpoint that HA polls, creating sensors for each unified device with all cross-referenced attributes.

```yaml
# HA configuration.yaml
rest:
  - resource: "http://electrical.local:3000/api/ha/devices/enriched"
    scan_interval: 300
    sensor:
      - name: "Unified Device Count"
        value_template: "{{ value_json.devices | length }}"
```

#### Option B: Custom Integration Entities (Rich)
The `nocodb_electrical` custom integration creates **device entries** in HA's device registry that mirror the unified inventory, with:
- Manufacturer, model, SW version from HA/UniFi data
- Circuit sensor as a linked entity
- Area auto-assignment from NocoDB room
- Custom attributes: `circuit_number`, `breaker_amps`, `power_source`, `network_mac`

This means HA's device page shows full electrical context alongside standard entity info.

#### Option C: PWA → HA Device Registry Sync (Bidirectional)
Use HA WebSocket `config/device_registry/update` to push metadata back:
- Set `suggested_area` based on NocoDB room assignment
- Update device `name_by_user` if user renames in PWA
- Add custom attributes via device triggers

### Recommended Approach

Start with **Option A** (lightweight REST exposure) in the near term, then build toward **Option B** as the custom integration matures. Option C is the ultimate goal but requires careful conflict resolution when both HA and PWA users edit the same device.

### Data Flow (Future State)

```
┌─────────────────────────────────────────────────────────────────┐
│                  Home Assistant                                    │
│                                                                   │
│  Device Registry ◄──── PWA pushes circuit/room metadata           │
│  Automations     ◄──── "circuit overload" triggers from PWA       │
│  Dashboards      ◄──── Unified device attributes for cards        │
│  Energy          ◄──── Per-circuit power (Emporia + topology)     │
└───────────┬───────────────────────────────────────────────────────┘
            │ WebSocket / REST
            ▼
┌─────────────────────────────────────────────────────────────────┐
│              PWA — Device Unification Layer                        │
│                                                                   │
│  NocoDB (electrical)  +  UniFi (network)  +  HA (smart home)     │
│  ───────────────────────────────────────────────────────────     │
│  Merged at runtime via match keys (MAC, HA_Device_Id)            │
│  Exposed via /api/ha/devices/enriched for HA consumption         │
└─────────────────────────────────────────────────────────────────┘
```

### Key Principle
The PWA is the **merge point** — it's the only system that knows a device's full story (which circuit, which switch port, which HA entities, which room, what warranty info). HA should be able to query this merged view for its own automations without needing to replicate the merge logic.

