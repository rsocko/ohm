# Multi-Home Architecture Design

## Problem

The app has a "Home" selector on the homepage, but:
1. **Sub-pages ignore it** — Rooms, Panels, Devices, Energy all show data from ALL homes
2. **Homepage doesn't fully filter** — Energy insights, data insights, panel slot usage show cross-home data
3. **Integrations are global singletons** — single HA config, single UniFi config, single Solar config — but user has separate instances per home

## Physical Reality

| Home | HA Instance | UniFi Gateway | Solar (Enphase) | Energy Monitor |
|------|-------------|---------------|-----------------|----------------|
| Home A | ha-a.local | unifi-a.local | ✅ via HA | Emporia (connected) |
| Home B | ha-b.local | unifi-b.local | ✅ via HA | Emporia (soon) |

- **NocoDB is shared** — single base with all homes, areas linked via `Home` relation
- Each home has completely independent smart-home infrastructure

## Design: Global Home Context

### 1. Shared Home Store (`$lib/stores/home-context.svelte.ts`)

```ts
// Persisted to localStorage, shared across all pages
interface HomeContext {
  selectedHomeId: number | null;
  selectedHomeName: string;
}

// Reactive store — all pages import this
export const homeContext: HomeContext = $state({...});

// Derived helpers for filtering
export const homeAreaIds: Set<number>;  // area IDs belonging to selected home
export const homePanelIds: Set<number>; // panels in those areas
// etc.
```

**Key behavior:**
- Set once on app init (auto-detect via geolocation or default to first home)
  > ⚠️ **Deployment note:** The Geolocation API requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API#secure_context). The app must be served over **HTTPS** (TLS) in production — plain `http://` will silently block `getCurrentPosition()` without ever showing a browser permission prompt. Use a reverse proxy (e.g. Caddy, nginx + Let's Encrypt) in front of the app.
- Persisted to `localStorage` so it survives page reloads
- Home switcher on homepage updates this store
- ALL pages read from this store to filter their data
- If only 1 home exists → hidden, no filtering needed

### 2. Data Filtering Strategy

The `dataStore` continues to hold ALL data (it's the offline cache). Each page derives its visible data by filtering against `homeContext.selectedHomeId`.

**Filtering chain:**
```
Home → Areas (via Area.Home link)
     → Panels (via Panel.Area → Area.Home)
     → Circuits (via Circuit.Panel → Panel.Area → Area.Home)
     → Loads (via Load.Area → Area.Home)
     → Receptacles (via Receptacle.Area → Area.Home)
     → Floorplans (via Floorplan.Area → Area.Home)
```

**Implementation:** Add a `homeFiltered` derived export to `data.svelte.ts`:

```ts
export const homeFiltered = $derived.by(() => {
  const homeId = homeContext.selectedHomeId;
  if (!homeId) return { areas: [], panels: [], circuits: [], loads: [], ... };
  
  const areaIds = new Set(
    state.areas
      .filter(a => (a.fields.Home as {id:number})?.id === homeId)
      .map(a => a.id)
  );
  const panels = state.panels.filter(p => areaIds.has((p.fields.Area as {id:number})?.id));
  const panelIds = new Set(panels.map(p => p.id));
  const circuits = state.circuits.filter(c => panelIds.has((c.fields.Panel as {id:number})?.id));
  const loads = state.loads.filter(l => areaIds.has((l.fields.Area as {id:number})?.id));
  // ...etc
  return { areas, panels, circuits, loads, receptacles, floorplans };
});
```

### 3. Per-Home Integration Configs

**Current:** Single flat file per integration
```
data/ha-config.json        → { url, token, enabled }
data/unifi-config.json     → { url, username, password, site }
data/solar-config.json     → { productionEntity, ... }
```

**Proposed:** Keyed by home ID
```
data/integrations/{homeId}/ha.json
data/integrations/{homeId}/unifi.json
data/integrations/{homeId}/solar.json
data/integrations/{homeId}/energy-monitor.json   (future: Emporia)
```

**Config API changes:**
- `getHAConfig()` → `getHAConfig(homeId: number)`
- `getUnifiConfig()` → `getUnifiConfig(homeId: number)`
- `getSolarConfig()` → `getSolarConfig(homeId: number)`

**Migration:** On first run with new schema, move existing `data/*.json` files into `data/integrations/{firstHomeId}/` automatically.

### 4. How API Endpoints Get Home Context

Two options:

**Option A: Query parameter** (simpler, explicit)
```
GET /api/energy/live?homeId=3
GET /api/devices/unified?homeId=3
GET /api/devices/discovery?homeId=3
```

**Option B: Cookie/session** (implicit, less URL noise)
- Store `selectedHomeId` in a cookie
- Server reads it from `event.cookies`

**Recommendation: Option A** — explicit is better for debugging, caching, and eventual multi-home dashboards.

### 5. Settings UI Redesign

**Current tabs:** Integrations | Mapping | Labels | Energy | General

**Proposed:** Add a home selector at the top of Settings:

```
┌─────────────────────────────────────┐
│ Settings                            │
│                                     │
│ Home: [▾ Mountain House      ]      │
│                                     │
│ ┌──────┬────────┬───────┬────────┐  │
│ │ Integ│ Mapping│ Energy│ General│  │
│ └──────┴────────┴───────┴────────┘  │
│                                     │
│ Home Assistant                      │
│ URL: https://ha-mountain.local      │
│ Token: ••••••••••                   │
│ Status: Connected ✓                 │
│                                     │
│ UniFi Network                       │
│ URL: https://unifi-mountain.local   │
│ Status: Connected ✓                 │
│                                     │
│ Solar / Enphase                     │
│ URL: (via Home Assistant above)     │
│ Production entity: sensor.envoy_... │
│ Status: Connected ✓                 │
│                                     │
└─────────────────────────────────────┘
```

- Switching the home dropdown in Settings shows that home's integration configs
- "Labels" and "General" tabs are global (not per-home)
- Tab badges show connection status per-home

### 6. Pages Affected

| Page | Current | After |
|------|---------|-------|
| **Homepage** | Home selector exists but only filters stats card | Filters everything: stats, insights, energy, panel usage |
| **Rooms** | Shows ALL areas | Shows only areas for selected home |
| **Panels** | Shows ALL panels | Shows only panels for selected home |
| **Devices** | Shows ALL devices | Shows only devices in selected home's areas + that home's UniFi/HA |
| **Energy** | Single SSE stream | Connects to selected home's HA for energy data |
| **Search** | Searches everything | Searches within selected home |
| **Settings** | Global configs | Per-home integration configs |

### 7. UI: Home Indicator

Add a subtle home indicator to the global layout (near the refresh/settings buttons):

```
[🏠 Mountain House ▾]  [↻ 2m ago]  [⚙]
```

Tapping opens a quick-switch dropdown. This replaces the homepage-only selector as the primary way to switch homes.

### 8. Implementation Phases

**Phase 1: Global home context + page filtering** (no backend changes)
- Create `home-context.svelte.ts` store with localStorage persistence
- Add `homeFiltered` derived to `data.svelte.ts`
- Update all pages to use filtered data
- Move home selector from homepage to global layout header
- Homepage insights/energy filter to selected home

**Phase 2: Per-home integration configs** (backend)
- Refactor config file structure to `data/integrations/{homeId}/`
- Update `getHAConfig`, `getUnifiConfig`, `getSolarConfig` to accept homeId
- Migration script for existing configs
- Update Settings UI with home selector
- Pass `homeId` query param from client to API endpoints

**Phase 3: Multi-home energy streams**
- SSE endpoint accepts homeId, connects to correct HA instance
- Energy history/solar APIs route to correct HA
- Device discovery scopes to correct UniFi/HA per home

### 9. Edge Cases

- **Loads without an Area:** Show under "Unassigned" regardless of home selection (they need to be placed)
- **Cross-home insights (future):** "Home B uses 30% more energy than Home A" — deferred, not default
- **Single-home users:** Home context is invisible, no selector shown, everything works as today
- **Offline:** localStorage persists selected home; cached data is already all-homes so filtering still works
