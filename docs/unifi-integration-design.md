# UniFi Network API Integration — Design Document

## Overview

Integrate the UniFi Network Application API into the Electrical Config AI PWA to enable automatic device discovery, POE budget monitoring, and network topology synchronization with the existing NocoDB-backed network layer.

## Architecture

```
┌─────────────────────────────────┐
│  Electrical Config AI PWA       │
│  (SvelteKit)                    │
│                                 │
│  ┌───────────────────────────┐  │
│  │ /api/unifi/* routes       │  │
│  │ (server-only)             │  │
│  └─────────┬─────────────────┘  │
│            │                    │
│  ┌─────────▼─────────────────┐  │
│  │ src/lib/server/unifi.ts   │  │
│  │ (API client)              │  │
│  └─────────┬─────────────────┘  │
└────────────┼────────────────────┘
             │ HTTPS (cookie auth)
             ▼
┌─────────────────────────────────┐
│  UniFi Cloud Gateway Max        │
│  https://unifi.socko.us         │
│                                 │
│  /proxy/network/api/s/default/  │
│    - stat/device                │
│    - stat/sta                   │
│    - rest/portconf              │
└─────────────────────────────────┘
```

## Authentication Flow

UniFi Network Application uses cookie-based session auth:

1. **Login**: `POST /api/auth/login` with `{ username, password }`
2. **Response**: Sets `TOKEN` and/or `unifises` cookies
3. **Subsequent requests**: Include cookies in all API calls
4. **Session expiry**: Cookie expires; 401 response triggers re-auth
5. **Logout** (optional): `POST /api/auth/logout`

### Implementation Notes

- Cookies stored in-memory on the server (never exposed to client)
- Auto-retry on 401 with fresh login
- Connection pooling via persistent cookie jar
- Self-signed cert handling via `NODE_TLS_REJECT_UNAUTHORIZED=0` env var (configurable)

## API Endpoints Used

### UniFi Network Application API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Authenticate and get session cookie |
| `/proxy/network/api/s/{site}/stat/device` | GET | All adopted devices (APs, switches, gateways) |
| `/proxy/network/api/s/{site}/stat/sta` | GET | All connected clients |
| `/proxy/network/api/s/{site}/stat/device/{mac}` | GET | Single device details |
| `/proxy/network/api/s/{site}/rest/portconf` | GET | Port profiles/configurations |
| `/api/s/{site}/stat/device` | GET | Alternate path (standalone controller) |

### Key Response Fields

**Device (`stat/device`)**:
```json
{
  "mac": "ab:cd:ef:12:34:56",
  "ip": "192.168.1.10",
  "name": "Office Switch",
  "model": "USW-24-PoE",
  "type": "usw",
  "adopted": true,
  "state": 1,
  "port_table": [
    {
      "port_idx": 1,
      "name": "Port 1",
      "poe_caps": 7,
      "poe_mode": "auto",
      "poe_enable": true,
      "poe_power": "3.42",
      "poe_voltage": "53.40",
      "poe_current": "64.00"
    }
  ],
  "system_stats": { ... },
  "uplink": { "mac": "...", "type": "wire" }
}
```

**Client (`stat/sta`)**:
```json
{
  "mac": "11:22:33:44:55:66",
  "ip": "192.168.1.50",
  "hostname": "camera-front",
  "name": "Front Camera",
  "sw_mac": "ab:cd:ef:12:34:56",
  "sw_port": 5,
  "network": "Default",
  "is_wired": true
}
```

## Data Mapping

### UniFi Device → NocoDB Load Record

| UniFi Field | NocoDB Load Field | Notes |
|-------------|-------------------|-------|
| `mac` | `Network_Match_Key` | Primary matching key |
| `name` | `Title` (display) | Don't overwrite user-set names |
| `type` | `Network_Role` | `ugw`→Router, `usw`→Switch, `uap`→AP |
| `ip` | (informational) | Show in UI, don't store |
| `port_table[].poe_power` | (POE view) | Aggregated per-switch |
| `uplink.mac` | `Network_Upstream` | Resolve to NocoDB Load ID |

### UniFi Client → NocoDB Load Record

| UniFi Field | NocoDB Load Field | Notes |
|-------------|-------------------|-------|
| `mac` | `Network_Match_Key` | Primary matching key |
| `hostname` / `name` | `Title` (display) | Fallback matching |
| `sw_mac` + `sw_port` | `Network_Upstream` | Identifies upstream switch |
| `is_wired` | (informational) | Wired clients are POE candidates |

### Network_Role Mapping

| UniFi `type` | `Network_Role` |
|-------------|----------------|
| `ugw` | Router |
| `usw` | Switch |
| `uap` | AP |
| — (client, camera) | Camera / Endpoint |

### Power_Source Inference

| Condition | `Power_Source` |
|-----------|---------------|
| Connected to POE port with `poe_enable=true` | POE or POE+ |
| `poe_power` > 15W | POE+ |
| `poe_power` ≤ 15W | POE |
| Not on POE port | AC |

## Sync Strategy

### On-Demand Sync (Phase 1)

1. User clicks "Sync Now" in Settings
2. Fetch all devices from UniFi API
3. For each device, match to NocoDB Load by `Network_Match_Key` (MAC)
4. Update matched records: `Network_Role`, `Power_Source`, `Network_Upstream`
5. Report: matched count, unmatched UniFi devices, unmatched NocoDB loads

### Auto-Matching Algorithm

```
1. Fetch all UniFi devices + clients
2. Fetch all NocoDB Loads with Network_Match_Key set
3. For each UniFi entity:
   a. Exact MAC match → link
   b. Name match (fuzzy, case-insensitive) → suggest
   c. IP match → suggest (IPs can change)
4. Return: { matched: [...], unmatched_unifi: [...], unmatched_nocodb: [...] }
```

### Topology Resolution

1. For each matched device/client, resolve `uplink.mac` or `sw_mac` to a NocoDB Load ID
2. Update `Network_Upstream` link field in NocoDB
3. This maintains the existing wire-run visualization in the floorplan

## POE Budget Model

### Per-Switch View
```
Switch: Office Switch (USW-24-PoE)
Total Budget: 95W (of 250W max)
├── Port 1: Front Camera — 8.2W (POE)
├── Port 2: Office AP — 12.1W (POE+)
├── Port 5: Desk Phone — 3.4W (POE)
└── Port 8: (unused POE port)
Budget Used: 38% ████████░░░░░░░░░░░░
```

### Data Model
```typescript
interface PoePortStatus {
  port_idx: number;
  name: string;
  poe_enable: boolean;
  poe_mode: 'auto' | 'pasv24' | 'passthrough' | 'off';
  poe_power: number;      // watts
  poe_voltage: number;    // volts
  poe_current: number;    // milliamps
  poe_class: string;      // '0'-'8' or 'Unknown'
  connected_mac?: string; // MAC of connected device
}

interface SwitchPoeBudget {
  mac: string;
  name: string;
  model: string;
  max_power: number;      // max POE budget in watts
  total_power: number;    // current draw in watts
  port_count: number;
  poe_ports: PoePortStatus[];
}
```

## Configuration

### Environment Variables (`.env`)
```env
# UniFi Network API
UNIFI_URL=https://unifi.socko.us
UNIFI_USERNAME=admin_user
UNIFI_PASSWORD=admin_pass
UNIFI_SITE=default
UNIFI_VERIFY_SSL=true
```

### Runtime Config (`data/unifi-config.json`)
```json
{
  "url": "https://unifi.socko.us",
  "username": "admin_user",
  "password": "",
  "site": "default",
  "verifySsl": true,
  "lastSyncAt": "2026-07-06T20:00:00.000Z",
  "updatedAt": "2026-07-06T19:00:00.000Z"
}
```

Password is stored in the config file for runtime updates but can be overridden by env vars. The config file is gitignored.

## API Routes (PWA)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/unifi/test` | POST | Test connection, return device count |
| `/api/unifi/devices` | GET | List all UniFi devices |
| `/api/unifi/clients` | GET | List all connected clients |
| `/api/unifi/poe/[mac]` | GET | POE port status for a switch |
| `/api/unifi/sync` | POST | Trigger topology sync |
| `/api/settings/unifi` | GET/POST | Read/write UniFi config |

## Security Considerations

- UniFi credentials stored server-side only (never sent to browser)
- Config file excluded from git (`.gitignore` entry for `data/`)
- API routes are server-only (SvelteKit `+server.ts`)
- Self-signed cert bypass is opt-in via `UNIFI_VERIFY_SSL=false`
- Consider adding app-level auth in future (currently local-only deployment)

## Future Enhancements (Out of Scope)

- WebSocket subscription for real-time device state changes
- UniFi Protect integration (cameras)
- VLAN topology visualization
- Alert rules (device offline, POE overload)
- Historical POE power graphing
