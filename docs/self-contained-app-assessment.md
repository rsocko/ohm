# Self-Contained Ohm App — Design Assessment & Plan

## Date

2026-07-10

## Status

**Draft** — Design assessment for review.

---

## Problem Statement

Ohm is deeply integrated with homelab infrastructure: NocoDB for the data store, Home Assistant for live energy monitoring, UniFi for network device discovery, and Open WebUI → Azure OpenAI for the AI chat. This makes it powerful for its primary user, but **impossible to share** with friends, family, or anyone who doesn't run a homelab.

**Question:** What would it take to ship Ohm as a self-contained app that *anyone* could download, install, and use to map their home's electrical system — with no external infrastructure?

---

## Current Architecture Dependency Map

| Layer | Current Dependency | Required? | Self-Contained Replacement |
|-------|-------------------|-----------|---------------------------|
| **Data Store** | NocoDB (REST API, self-hosted) | ✅ Must replace | SQLite (embedded, on-device) |
| **Energy Monitoring** | Home Assistant + Emporia Vue + Enphase | ❌ Optional feature | Disable or manual entry |
| **Network Devices** | UniFi Controller API | ❌ Optional feature | Disable entirely |
| **AI Chat** | Open WebUI → Azure OpenAI | ❌ Optional feature | Disable, or use device-local/cloud API key |
| **File Storage** | NocoDB attachment storage | ✅ Must replace | Local filesystem or IndexedDB |
| **Server Runtime** | Node.js (adapter-node, SSR) | ✅ Must replace for native | Static adapter + client-side logic |
| **Deployment** | Docker → Traefik → homelab | ✅ Must replace | App Store / PWA install |
| **Auth** | None (single-user homelab) | N/A | Optional for self-contained |

---

## Feature-by-Feature Analysis

### ✅ Features That Work As-Is in Self-Contained Mode

These are the core value of Ohm and **require only a data store swap** (NocoDB → SQLite):

| Feature | Notes |
|---------|-------|
| **Circuit topology browsing** | Panels → Circuits → Loads → Receptacles → Rooms |
| **Multi-home support** | Switch between properties |
| **Room / Area management** | CRUD for rooms with floor assignments |
| **Load & receptacle tracking** | Create, edit, link to circuits and rooms |
| **Panel schedule view** | Full breaker layout |
| **Search across all entities** | Already client-side friendly |
| **Comments system** | Notes on circuits, rooms, etc. |
| **QR code generation** | Already client-side (qrcode lib) |
| **Siri Shortcut guide** | Static documentation page |
| **Settings UI** | Would simplify to SQLite-only config |
| **Photo attachments** | Switch from NocoDB uploads to local storage |

**Estimated coverage: ~60-70% of current app functionality** — and this is the *most-used* 60-70%.

### ⚠️ Features That Need Modification

| Feature | Current Behavior | Self-Contained Approach | Effort |
|---------|-----------------|------------------------|--------|
| **AI "Ask Ohm"** | Calls Open WebUI → Azure OpenAI with NocoDB context | Option A: Disable entirely. Option B: Let user bring their own OpenAI API key, run directly against OpenAI API. The AI tools would query SQLite instead of NocoDB. | Medium |
| **Photo uploads** | Uploads to NocoDB storage via REST | Store in app's local filesystem (Capacitor) or IndexedDB (PWA) | Low-Medium |
| **Data import/export** | None currently | **New feature needed** — users need a way to seed their data. CSV import, or a guided setup wizard. | Medium |

### ❌ Features That Must Be Disabled / Removed

| Feature | Why | Impact |
|---------|-----|--------|
| **Live energy monitoring** | Requires Home Assistant + Emporia Vue hardware | High — this is a major feature, but users without the hardware simply can't use it |
| **Solar production tracking** | Requires Enphase integration via HA | Same as above |
| **EV charging monitoring** | Requires HA sensors | Same |
| **UniFi device discovery** | Requires UniFi Controller | Low — niche feature |
| **UniFi PoE management** | Requires UniFi Controller | Low |
| **Device auto-discovery** | Requires both UniFi and HA | Low |
| **HA entity control** | Toggle switches/lights via HA | Low |
| **Energy history charts** | Requires HA history API | Medium — nice to have but hardware-dependent |
| **MCP tool server** | Requires Open WebUI MCPO | Low |

---

## Architecture Options for Self-Contained Delivery

### Option A: Capacitor PWA → Native iOS App (Recommended for MVP)

**How it works:** Capacitor wraps the SvelteKit static build in a native iOS WebView. SQLite runs natively via `@capacitor-community/sqlite`. The app is distributed through TestFlight (personal) or the App Store.

```
┌─────────────────────────────────────────────┐
│  iOS Native Shell (Capacitor)               │
│  ┌───────────────────────────────────────┐  │
│  │  SvelteKit (adapter-static)           │  │
│  │  ┌─────────┐  ┌──────────────────┐   │  │
│  │  │ UI Layer │  │ Client-side API  │   │  │
│  │  │ (Svelte) │  │ (replaces SSR    │   │  │
│  │  │          │  │  server routes)  │   │  │
│  │  └────┬─────┘  └────────┬─────────┘   │  │
│  │       │                 │              │  │
│  │       └────────┬────────┘              │  │
│  │                │                       │  │
│  │       ┌────────▼────────┐              │  │
│  │       │  SQLite Provider │              │  │
│  │       │  (implements     │              │  │
│  │       │   DataProvider)  │              │  │
│  │       └────────┬────────┘              │  │
│  └────────────────│────────────────────┘  │
│                   │                       │
│          ┌────────▼────────┐              │
│          │ Native SQLite   │              │
│          │ (Capacitor      │              │
│          │  plugin)        │              │
│          └─────────────────┘              │
└─────────────────────────────────────────────┘
```

**Pros:**
- True native app experience (App Store, icon, offline)
- Native SQLite performance (no WASM overhead)
- Capacitor plugin ecosystem for camera, filesystem, haptics
- You already analyzed Capacitor in `native-ios-decision.md` — it's non-destructive to bolt on
- TestFlight distribution to family/friends without App Store review

**Cons:**
- $99/year Apple Developer account
- Must switch to `adapter-static` (no SSR) for the self-contained build
- Requires maintaining two build targets (homelab SSR + Capacitor static)
- Xcode + macOS required for builds
- Server routes (`src/routes/api/*`) must be refactored to client-side service calls

### Option B: PWA with WASM SQLite (No Native Wrapper)

**How it works:** Ship as a pure PWA using `sql.js` (SQLite compiled to WebAssembly) or the Origin Private File System (OPFS) SQLite backend. Data lives in the browser.

**Pros:**
- No App Store, no Apple Developer account
- Works on any platform (iOS, Android, desktop)
- Already a PWA with service worker caching
- No Xcode or native tooling needed

**Cons:**
- iOS Safari PWA limitations (7-day storage eviction if not used, no background sync)
- WASM SQLite is ~2-5x slower than native (negligible for this data volume)
- No native filesystem access (photos go to IndexedDB)
- Can't be shared via "install from App Store" — must share a URL
- Users may lose data if they clear browser storage

### Option C: Hosted Free Tier (Fly.io / Railway / Vercel)

**How it works:** Deploy the existing SSR app on a free cloud platform with a managed SQLite (Turso/LiteFS) or PostgreSQL (Neon) database. Share a URL.

**Pros:**
- Minimal code changes — keep SSR, just swap NocoDB for hosted DB
- Familiar deployment model
- No iOS-specific concerns

**Cons:**
- Each user needs their own instance or multi-tenant auth is required
- Free tiers have limits, may shut down
- Not truly "self-contained" — still depends on cloud
- Doesn't address the "download and own it" use case

---

## Recommendation: PWA + Cloud Backup (No Native Wrapper Needed for MVP)

**The addition of cloud backup via OneDrive/Google Drive fundamentally changes the tradeoff.** Previously, Capacitor was needed to protect against iOS data eviction. With cloud backup, data survives eviction automatically — the app detects an empty local DB on launch, pulls the backup from the user's own cloud storage, and restores seamlessly.

**Phase 1 (MVP):** Build with WASM SQLite + OneDrive/Google Drive auto-backup. Host the static PWA on GitHub Pages (free). Share a URL. Users install to home screen, sign in with their Microsoft or Google account for backup. Zero ongoing infrastructure cost.

**Phase 2:** If there's real adoption, optionally add Capacitor for App Store distribution and native camera access. But this is no longer a data-safety requirement — it's a distribution convenience.

---

## What Has to Change — Technical Requirements

### 1. SQLite DataProvider (Core — Must Build)

The app already has a `DataProvider` interface (`src/lib/server/db/provider.ts`) with clean domain models. The NocoDB provider is the only implementation today. **This is the single biggest enabler** — building a `SQLiteProvider` that implements the same interface means all existing UI code works unchanged.

```typescript
// src/lib/db/sqlite-provider.ts (note: NOT in server/ — must be client-accessible)
export class SQLiteProvider implements DataProvider {
  private db: Database; // sql.js or capacitor-sqlite

  async getHomes(): Promise<Home[]> { ... }
  async getCircuits(panelId?: number): Promise<Circuit[]> { ... }
  async createLoad(data: LoadCreate): Promise<Load> { ... }
  // ... all 30+ methods from the DataProvider interface
}
```

**Schema** — maps directly from the existing NocoDB tables:

```sql
CREATE TABLE homes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT, city TEXT, state TEXT, zip TEXT
);

CREATE TABLE rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  floor TEXT, description TEXT,
  home_id INTEGER REFERENCES homes(id)
);

CREATE TABLE panels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT, service_size INTEGER, phases INTEGER,
  home_id INTEGER REFERENCES homes(id)
);

CREATE TABLE circuits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL,
  amps INTEGER NOT NULL DEFAULT 15,
  description TEXT,
  gfci_protected BOOLEAN DEFAULT 0,
  breaker_type TEXT,
  panel_id INTEGER REFERENCES panels(id),
  room_id INTEGER REFERENCES rooms(id)
);

CREATE TABLE loads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  device_type TEXT, wattage REAL, fixture_count INTEGER,
  room_id INTEGER REFERENCES rooms(id),
  circuit_id INTEGER REFERENCES circuits(id)
);

CREATE TABLE receptacles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT, gang_position INTEGER,
  loc_direction TEXT, loc_placement TEXT, loc_rec_index INTEGER,
  room_id INTEGER REFERENCES rooms(id),
  circuit_id INTEGER REFERENCES circuits(id)
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  author TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT, entity_id INTEGER,
  filename TEXT, mimetype TEXT,
  data BLOB
);
```

**Effort:** 3-5 days for the provider + schema + migrations.

### 2. Build Mode / Feature Gating

The app already has a `DEMO_MODE` flag. Extend this concept to a `STANDALONE_MODE`:

```typescript
// src/lib/config/app-mode.ts
export type AppMode = 'homelab' | 'standalone' | 'demo';

export function getAppMode(): AppMode {
  if (env.DEMO_MODE === 'true') return 'demo';
  if (env.STANDALONE_MODE === 'true') return 'standalone';
  return 'homelab';
}

export function hasFeature(feature: string): boolean {
  const standalone_disabled = [
    'energy-live', 'energy-history', 'solar',
    'unifi', 'device-discovery', 'ha-control', 'mcp'
  ];
  if (getAppMode() === 'standalone') {
    return !standalone_disabled.includes(feature);
  }
  return true;
}
```

The UI already has conditional rendering patterns from demo mode — this extends naturally.

**Effort:** 1-2 days.

### 3. Adapter Switch (Static Build)

For the self-contained PWA/Capacitor build, switch from `adapter-node` to `adapter-static`:

```javascript
// svelte.config.js (standalone build)
import adapter from '@sveltejs/adapter-static';

const config = {
  kit: {
    adapter: adapter({ fallback: 'index.html' })
  }
};
```

All `+server.ts` API routes stop working in static mode. The data calls must be moved client-side. This is the biggest refactoring item.

**Approach:** Create a client-side service layer that mirrors the server API routes but calls SQLite directly:

```
Current: UI → fetch('/api/nocodb?action=records') → +server.ts → NocoDB
Self-contained: UI → import { db } from '$lib/db' → SQLiteProvider → sql.js
```

**Effort:** 3-4 days to refactor the data flow. Many routes are thin wrappers around the DataProvider, so this is mostly plumbing.

### 4. First-Start Experience & Progressive Onboarding

New users currently land on the home dashboard with empty data — no homes, no panels, no guidance. This section designs a first-start experience that works for **both** standalone and homelab users.

#### Design Principles

1. **Get to value in under 2 minutes** — a user should see *their* panel mapped (even partially) before they lose interest
2. **Progressive disclosure** — start with the minimum (home + panel + circuits), let them flesh out rooms/receptacles/loads later
3. **Never block on optional steps** — cloud backup sign-in, room mapping, and load details are all skippable
4. **Works for both modes** — the same onboarding flow benefits homelab users setting up a new home in NocoDB

#### First-Start Flow

```
┌──────────────────────────────────────────────────────────────────┐
│  APP LAUNCH (first time — no data detected)                      │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  STEP 1: Welcome                                          │  │
│  │  "Welcome to Ohm ⚡ Let's map your home's electrical      │  │
│  │   system. This takes about 2 minutes."                    │  │
│  │                                                           │  │
│  │  [Get Started]                                            │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  STEP 2: Cloud Backup (Standalone only)                   │  │
│  │  "Sign in to protect your data. Your electrical map       │  │
│  │   backs up to your own OneDrive or Google Drive."         │  │
│  │                                                           │  │
│  │  [Sign in with Microsoft]  [Sign in with Google]          │  │
│  │                                                           │  │
│  │  (Skip for now) ← clearly available, no guilt             │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  STEP 3: Your Home                                        │  │
│  │  "What's this home called?"                               │  │
│  │                                                           │  │
│  │  Name: [Willow House_____________]                          │  │
│  │  Address: [12 Example Ln________] (optional)               │  │
│  │  City/State/Zip: [___] [__] [___] (optional)              │  │
│  │                                                           │  │
│  │  [Continue]                                               │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  STEP 4: Your Panel ← This is the critical step           │  │
│  │  "Most homes have one main panel. Let's set it up."       │  │
│  │                                                           │  │
│  │  Panel Name: [Main Panel_______]                          │  │
│  │  Location:   [Basement_________]                          │  │
│  │  Service Size: (100A) (●200A) (400A) (Other)              │  │
│  │  Number of Spaces: [40___]                                │  │
│  │                                                           │  │
│  │  ○ Start from a template (typical 200A residential)       │  │
│  │  ○ Start empty (I'll add circuits one by one)             │  │
│  │                                                           │  │
│  │  [Continue]                                               │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  STEP 5: Quick Circuit Entry (MVP — the "2 minute" step)  │  │
│  │                                                           │  │
│  │  If template: show pre-filled panel schedule, let user     │  │
│  │  rename/edit circuits inline                               │  │
│  │                                                           │  │
│  │  If empty: show panel schedule grid, let user type         │  │
│  │  circuit descriptions inline (breaker-by-breaker)          │  │
│  │                                                           │  │
│  │  ┌─────┬──────┬────────────────────┬───────┐              │  │
│  │  │  #  │ Amps │ Description        │ Room  │              │  │
│  │  ├─────┼──────┼────────────────────┼───────┤              │  │
│  │  │  1  │ 20   │ [Counter Plugs___] │ (opt) │              │  │
│  │  │  2  │ 15   │ [________________] │ (opt) │              │  │
│  │  │  3  │ 20   │ [Dishwasher______] │ (opt) │              │  │
│  │  │  ...│      │                    │       │              │  │
│  │  └─────┴──────┴────────────────────┴───────┘              │  │
│  │                                                           │  │
│  │  "You can add rooms, outlets, and devices later."         │  │
│  │  [Done — Go to Dashboard]                                 │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  DASHBOARD — with data! User sees their panel, circuits,  │  │
│  │  and a "completeness" nudge for the next level of detail. │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

#### Progressive Detail Levels

The onboarding doesn't try to capture everything. Instead, it establishes **tiers of completeness** that the user can work through at their own pace:

| Level | What's Captured | When | Effort for User |
|-------|----------------|------|-----------------|
| **Level 1: Panel Map** ✅ (onboarding) | Home → Panel → Circuits (number + amps + description) | First 2 minutes | Minimal — read your panel door label |
| **Level 2: Room Assignment** | Assign circuits to rooms | After onboarding, from panel or room views | 5-10 min — walk the house |
| **Level 3: Receptacles** | Map outlets/switches per room and link to circuits | Over days/weeks | 20-30 min per room |
| **Level 4: Loads** | Individual devices, wattage, device types | Over weeks | Ongoing as you discover things |
| **Level 5: Photos & Notes** | Panel photos, outlet photos, maintenance notes | Anytime | Seconds per item |

#### Dashboard Completeness Nudges

After initial setup, the dashboard shows gentle prompts to fill in the next level:

```
┌─────────────────────────────────────────────────┐
│  📊 Your Electrical Map                         │
│                                                 │
│  ✅ Panel mapped (32 of 40 breakers labeled)    │
│  ◐ 8 circuits have no room assigned             │
│     → Tap to assign rooms                       │
│  ○ No receptacles mapped yet                    │
│     → Start mapping outlets room by room        │
│  ○ No device loads tracked yet                  │
│     → Add what's plugged in where               │
│                                                 │
│  Completeness: ████████░░░░░░░░ 40%             │
└─────────────────────────────────────────────────┘
```

This progress indicator works as a checklist without being pushy. It answers "what should I do next?" for users who want to flesh out their data.

#### Panel Templates (MVP)

Pre-built circuit templates for common residential panels to accelerate Step 5:

```typescript
// src/lib/config/panel-templates.ts

export const PANEL_TEMPLATES = {
  'residential-200a-40space': {
    name: 'Typical 200A Residential (40-space)',
    serviceSize: 200,
    spaces: 40,
    circuits: [
      { number: 1,  amps: 20,  description: 'Kitchen Counter Plugs (GFCI)', gfci: true },
      { number: 2,  amps: 20,  description: 'Kitchen Counter Plugs (GFCI)', gfci: true },
      { number: 3,  amps: 20,  description: 'Dishwasher' },
      { number: 5,  amps: 20,  description: 'Microwave / Hood' },
      { number: 7,  amps: 15,  description: 'Refrigerator' },
      { number: 9,  amps: 15,  description: 'Living Room Lights' },
      { number: 11, amps: 15,  description: 'Living Room Plugs' },
      { number: 13, amps: 15,  description: 'Master Bedroom' },
      { number: 15, amps: 15,  description: 'Bedroom 2' },
      { number: 17, amps: 15,  description: 'Bedroom 3' },
      { number: 19, amps: 20,  description: 'Bathroom (GFCI)', gfci: true },
      { number: 21, amps: 20,  description: 'Garage Plugs (GFCI)', gfci: true },
      { number: 23, amps: 20,  description: 'Outdoor / Patio (GFCI)', gfci: true },
      { number: 25, amps: 20,  description: 'Laundry' },
      { number: 4,  amps: 30,  description: 'Dryer (240V)', breakerType: '2-pole' },
      { number: 8,  amps: 40,  description: 'Range / Oven (240V)', breakerType: '2-pole' },
      { number: 12, amps: 30,  description: 'A/C Condenser (240V)', breakerType: '2-pole' },
      { number: 16, amps: 30,  description: 'Water Heater (240V)', breakerType: '2-pole' },
    ]
  },
  'residential-100a-20space': {
    name: 'Older 100A Residential (20-space)',
    serviceSize: 100,
    spaces: 20,
    circuits: [
      { number: 1,  amps: 20,  description: 'Kitchen' },
      { number: 3,  amps: 15,  description: 'Living Room' },
      { number: 5,  amps: 15,  description: 'Bedrooms' },
      { number: 7,  amps: 20,  description: 'Bathroom (GFCI)', gfci: true },
      { number: 9,  amps: 15,  description: 'Basement / Utility' },
      { number: 2,  amps: 30,  description: 'Dryer (240V)', breakerType: '2-pole' },
      { number: 6,  amps: 40,  description: 'Range (240V)', breakerType: '2-pole' },
    ]
  },
  'empty': {
    name: 'Empty Panel (I\'ll add circuits manually)',
    serviceSize: 200,
    spaces: 40,
    circuits: []
  }
};
```

#### Applicability to Homelab (Non-Standalone) Mode

This onboarding experience is equally valuable for homelab users:

| Scenario | How It Helps |
|----------|-------------|
| **Adding a second home** | Same wizard flow for a new property — skips backup step |
| **New NocoDB user** | Currently they face an empty app with no guidance |
| **Onboarding a family member** | "Here, add your house" works the same in both modes |
| **Template circuits** | Even homelab users benefit from a starting template vs. blank panel |

The wizard writes to whichever `DataProvider` is active (NocoDB or SQLite), so it's fully mode-agnostic.

#### First-Start Detection

```typescript
// src/lib/stores/onboarding.svelte.ts

export const onboarding = $state({
  completed: false,
  currentStep: 0,
  skippedBackup: false,
});

export async function checkFirstStart(): Promise<boolean> {
  const homes = await db.getHomes();
  if (homes.length === 0) {
    onboarding.completed = false;
    return true; // Show onboarding
  }
  onboarding.completed = true;
  return false;
}
```

The layout detects zero homes on first load and renders the onboarding overlay instead of the dashboard. After completion, it never shows again (but "Add another home" reuses Steps 3-5).

#### Effort Estimate

| Task | Days | MVP or Enhanced |
|------|------|----------------|
| First-start detection + routing | 0.5 | MVP |
| Welcome + cloud backup step | 1 | MVP |
| Home creation step | 0.5 | MVP |
| Panel creation + template picker | 1-2 | MVP |
| Inline circuit entry grid | 2-3 | MVP |
| Completeness progress indicator | 1 | MVP |
| Dashboard nudges for Level 2-5 | 1-2 | Enhanced |
| Room assignment quick-flow | 1-2 | Enhanced |
| "Add another home" re-entry | 0.5 | Enhanced |
| **Total** | **8-12 days** | |

### 5. Optional: Bring-Your-Own AI Key

For users who want the "Ask Ohm" AI feature without Open WebUI:

```typescript
// Direct OpenAI call (no Open WebUI middleman)
import { openai } from '@ai-sdk/openai';

const model = openai('gpt-4o-mini', {
  apiKey: userSettings.openaiApiKey // stored in SQLite settings table
});
```

The AI tools already query the DataProvider for context — they'd just query SQLite instead of NocoDB. The streaming chat UI needs no changes.

**Effort:** 2-3 days (refactor AI config, add API key settings UI, test tool calling against SQLite).

### 6. Cloud Backup via User's Own Cloud Storage (Critical for PWA Viability)

The biggest risk with the PWA-only path is iOS Safari's storage eviction policy — after ~7 days of inactivity, WebKit can silently delete all app data (OPFS, IndexedDB, Cache Storage). For an app like Ohm where users map their panel once and reference it occasionally, this is near-certain data loss.

**Solution:** Auto-backup the SQLite database to the user's own cloud storage. No server required from us — the user authenticates directly with their cloud provider, and we write to an isolated app-only folder.

#### How It Works

```
┌──────────────────────────────────────────────────────────────┐
│  Ohm PWA (browser)                                          │
│                                                              │
│  User edits circuit data                                     │
│       │                                                      │
│       ▼                                                      │
│  ┌─────────────┐    on every save    ┌────────────────────┐  │
│  │ WASM SQLite  │ ──────────────────▶│ Backup Service     │  │
│  │ (OPFS)       │                    │                    │  │
│  └─────────────┘                     │ 1. Export DB → JSON│  │
│                                      │ 2. PUT to cloud    │  │
│       ▲                              │    storage API     │  │
│       │          on app launch       └────────┬───────────┘  │
│       │                                       │              │
│  ┌────┴────────┐  if local DB empty  ┌────────▼───────────┐  │
│  │ Restore     │◀────────────────────│ OneDrive / GDrive  │  │
│  │ from cloud  │                     │ App Folder         │  │
│  └─────────────┘                     └────────────────────┘  │
└──────────────────────────────────────────────────────────────┘

On the cloud side, the data lives in a sandboxed app folder:

OneDrive: /Apps/Ohm/backup.json     ← only Ohm can see this
GDrive:   appDataFolder/backup.json  ← hidden from user's Drive UI
iCloud:   (not available in browser — requires native/Capacitor)
```

#### Provider Comparison

| Provider | API | Permission Scope | App Folder? | Browser Auth | Notes |
|----------|-----|-----------------|-------------|-------------|-------|
| **OneDrive (Preferred)** | Microsoft Graph `/me/drive/special/approot` | `Files.ReadWrite.AppFolder` | ✅ `/Apps/Ohm/` | MSAL.js (PKCE) | You already have Entra ID experience. Minimal scope — can't read user's other files |
| **Google Drive** | Drive API v3 `appDataFolder` | `drive.appdata` | ✅ Hidden folder | Google Identity Services | Similar concept, hidden from user's Drive UI |
| **Dropbox** | Dropbox API `/files/upload` | `files.app_folder` | ✅ `/Apps/Ohm/` | OAuth2 PKCE | Less common but same pattern |

All three use the same fundamental pattern: OAuth2 PKCE from the browser → scoped token → PUT/GET a JSON file to a sandboxed app folder.

#### OneDrive Implementation (Preferred — Detailed)

Since you already have Entra ID app registration experience, this is the fastest path:

**1. Entra ID App Registration:**
```
App Registration:
  - Platform: SPA (Single Page Application)
  - Redirect URI: https://ohm-app.github.io (or wherever PWA is hosted)
  - Delegated Permission: Files.ReadWrite.AppFolder
  - Authority: https://login.microsoftonline.com/consumers  ← personal MS accounts
```

**2. MSAL.js Auth Flow (client-side, no server):**
```typescript
// src/lib/backup/onedrive.ts
import { PublicClientApplication } from '@azure/msal-browser';

const msalConfig = {
  auth: {
    clientId: 'YOUR_ENTRA_APP_CLIENT_ID',
    authority: 'https://login.microsoflintonline.com/consumers',
    redirectUri: window.location.origin,
  }
};

const msal = new PublicClientApplication(msalConfig);
const scopes = ['Files.ReadWrite.AppFolder'];

export async function signIn() {
  return msal.loginPopup({ scopes });
}

async function getToken(): Promise<string> {
  const accounts = msal.getAllAccounts();
  if (accounts.length === 0) throw new Error('Not signed in');
  const response = await msal.acquireTokenSilent({ scopes, account: accounts[0] });
  return response.accessToken;
}
```

**3. Backup & Restore (Graph API — no server needed):**
```typescript
export async function backupToOneDrive(data: object): Promise<void> {
  const token = await getToken();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });

  // PUT to app folder — creates/overwrites /Apps/Ohm/backup.json
  await fetch(
    'https://graph.microsoft.com/v1.0/me/drive/special/approot:/backup.json:/content',
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: blob,
    }
  );
}

export async function restoreFromOneDrive(): Promise<object | null> {
  const token = await getToken();
  const resp = await fetch(
    'https://graph.microsoft.com/v1.0/me/drive/special/approot:/backup.json:/content',
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!resp.ok) return null; // No backup exists yet
  return resp.json();
}
```

**4. Auto-Backup Strategy:**
```typescript
// After every data mutation (create/update/delete):
async function onDataChanged() {
  const allData = await exportDatabase(); // Serialize all tables to JSON
  await backupToOneDrive(allData);        // ~50-200KB for a typical home
}

// On app launch:
async function onAppStart() {
  const localDb = await openLocalSQLite();
  if (localDb.isEmpty() && isSignedIn()) {
    const backup = await restoreFromOneDrive();
    if (backup) await importDatabase(backup); // Restore from cloud
  }
}
```

**What the user sees on OneDrive:**
```
OneDrive/
  Apps/
    Ohm/
      backup.json          ← ~50-200KB, auto-managed
      backup-2026-07-10.json  ← optional: keep last N snapshots
```

The `Apps/Ohm/` folder is visible in their OneDrive but Ohm only requests `Files.ReadWrite.AppFolder` — it **cannot** read or write any other files in their OneDrive.

#### Google Drive Alternative

For users without a Microsoft account:

```typescript
// src/lib/backup/google-drive.ts
// Uses Google Identity Services (GIS) + Drive API v3

export async function backupToGoogleDrive(data: object): Promise<void> {
  const token = await getGoogleToken(); // GIS tokenClient.requestAccessToken()

  // Check if backup file already exists
  const listResp = await fetch(
    'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name="backup.json"',
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const existing = await listResp.json();
  const fileId = existing.files?.[0]?.id;

  const metadata = { name: 'backup.json', ...(!fileId && { parents: ['appDataFolder'] }) };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(data)], { type: 'application/json' }));

  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

  await fetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form,
  });
}
```

#### Does This Solve the iOS Eviction Problem?

**Yes, completely.** Here's the updated lifecycle:

```
Day 1:   User signs in with Microsoft account, maps panel     ✅
         → Data saved to OPFS SQLite + auto-backed up to OneDrive
Day 3:   Adds more circuits                                   ✅
         → Incremental backup to OneDrive
Day 10:  iOS evicts OPFS/IndexedDB storage                    💀
Day 14:  Opens app again
         → App shell loads from hosted URL                     ✅
         → Local SQLite DB is empty
         → Detects signed-in Microsoft account
         → Downloads backup.json from OneDrive App Folder      ✅
         → Restores full database                              ✅
         → User sees all their data, no loss                   ✅
```

**This eliminates the need for Capacitor just to protect data.** The Capacitor path becomes a "nice to have" for App Store distribution rather than a "must have" for data safety.

#### Cloud Backup Effort Estimate

| Task | Days | Description |
|------|------|-------------|
| Entra ID app registration | 0.5 | You've done this before |
| MSAL.js integration | 1 | Sign-in flow, token management |
| OneDrive backup/restore | 1-2 | PUT/GET to app folder, JSON serialize/deserialize |
| Google Drive alternative | 1-2 | Same pattern, different auth library |
| Auto-backup on mutation | 0.5 | Debounced save after every data change |
| Restore-on-launch flow | 0.5 | Detect empty DB, offer restore |
| Settings UI (sign in/out, backup status) | 1 | Show last backup time, manual backup button |
| **Total** | **5-7 days** | |

#### Revised Architecture with Cloud Backup

This changes the recommendation. With cloud backup, the architecture becomes:

```
┌─────────────────────────────────────────────────────────────────┐
│  Ohm PWA (hosted on GitHub Pages / Cloudflare — free)          │
│                                                                 │
│  ┌───────────────┐   ┌──────────────┐   ┌──────────────────┐   │
│  │ SvelteKit     │   │ WASM SQLite  │   │ Cloud Backup     │   │
│  │ (adapter-     │──▶│ (OPFS)       │──▶│ (OneDrive /      │   │
│  │  static)      │   │              │   │  Google Drive)   │   │
│  └───────────────┘   └──────────────┘   └──────────────────┘   │
│                                                                 │
│  No server. No backend. No infrastructure to maintain.          │
│  User's data lives in their own cloud storage.                  │
└─────────────────────────────────────────────────────────────────┘
```

**You host nothing except static files. The user's data lives in their own OneDrive/Google Drive. If iOS evicts local storage, it auto-restores on next launch. Zero ongoing cost.**

---

## Level of Effort Summary

### MVP (Core Electrical Mapping + Cloud Backup + Onboarding)

| Task | Days | Description |
|------|------|-------------|
| SQLite DataProvider | 3-5 | Implement all DataProvider methods against SQLite |
| SQLite schema + migrations | 1 | Create tables, seed script |
| Feature gating system | 1-2 | Disable energy/UniFi/HA features in standalone mode |
| Client-side data layer | 3-4 | Move data access from server routes to client-side SQLite calls |
| Adapter-static build | 1 | Configure static adapter, fix SSR-only imports |
| First-start onboarding wizard | 4-6 | Welcome → cloud sign-in → home → panel → circuit entry (works in both modes) |
| Panel templates | 1 | Pre-built 200A/100A residential circuit templates |
| Cloud backup — OneDrive (primary) | 2-3 | MSAL.js auth + Graph API app folder backup/restore |
| Cloud backup — Google Drive (alt) | 1-2 | GIS auth + Drive API appDataFolder |
| Backup UX (settings, auto-save, restore) | 1-2 | Sign-in UI, backup status, restore-on-empty-launch |
| UI adjustments | 1-2 | Hide disabled features, adjust nav/settings |
| Testing & polish | 2-3 | End-to-end testing of standalone + onboarding flow |
| **Total MVP** | **21-31 days** | **~5-7 weeks of part-time work** |

### Phase 2 Enhancements (Post-MVP)

| Task | Days | Description |
|------|------|-------------|
| Dashboard completeness nudges | 1-2 | Progress bar + "next step" prompts for rooms, receptacles, loads |
| Room assignment quick-flow | 1-2 | Streamlined circuit → room linking after onboarding |
| Capacitor wrapper | 2-3 | Native iOS shell, TestFlight distribution (optional — cloud backup reduces urgency) |
| Native SQLite (replace WASM) | 1-2 | Swap sql.js for @capacitor-community/sqlite |
| Bring-your-own AI key | 2-3 | Direct OpenAI integration with SQLite context |
| Data import/export (CSV) | 2 | Import from spreadsheet, export for backup |
| Camera integration | 1-2 | Take photos of panels/receptacles via Capacitor |
| Multi-device sync | 2-3 | Cloud backup already enables this — detect conflicts, merge |
| **Total Phase 2** | **13-19 days** | **~3-5 weeks of part-time work** |

---

## Pros & Cons of Going Self-Contained

### Pros

1. **Dramatically expands audience** — anyone with a home can use it, not just homelab operators
2. **Core value is the topology mapping** — that doesn't need any external services
3. **DataProvider abstraction already exists** — the hardest architectural decision is already made
4. **Demo mode proves the concept** — the app already runs without external services using fixtures
5. **PWA infrastructure is in place** — service worker, manifest, offline caching
6. **Forces good architecture** — the provider pattern, feature gating, and client-side capabilities benefit the homelab version too
7. **Backup/portability** — SQLite file is a complete backup, trivially portable

### Cons

1. **4-6 weeks of work** for MVP — significant investment for a personal project
2. **Two build targets to maintain** — homelab (SSR + NocoDB) vs standalone (static + SQLite)
3. **Server routes must be refactored** — moving from SSR API routes to client-side service calls is the biggest single task
4. **Reduced feature set** — no live energy monitoring significantly reduces the "wow factor"
5. **Requires user to sign in with Microsoft/Google** — cloud backup needs OAuth consent (but optional — app works without it, just with eviction risk)
6. **No data sync between devices** until Phase 2 — each device has its own local copy (cloud backup enables this later)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Two build targets diverge over time | High | Medium | Shared DataProvider interface keeps core logic unified |
| PWA storage eviction on iOS | Medium | ~~High~~ **Low** | **Cloud backup auto-restores on next launch** |
| Users find topology-only mode underwhelming | Medium | Medium | Template homes + guided wizard make setup fast and rewarding |
| AI feature requires API key most users won't have | High | Low | Make it optional; core app works without it |
| Refactoring server routes breaks homelab version | Low | High | Feature flags + separate adapter configs keep builds isolated |
| User doesn't sign in to OneDrive/Google | Medium | Medium | App still works locally; prompt to sign in with clear explanation of why |
| OAuth token expires / consent revoked | Low | Low | MSAL handles silent renewal; re-prompt if needed |

---

## Recommendation

**Yes, this is feasible and worth exploring**, with caveats:

1. **Start with the SQLite DataProvider** — this is the highest-leverage work item. Once it exists, both the self-contained app and the homelab version benefit (SQLite is a better backup/export story than NocoDB regardless).

2. **Cloud backup via OneDrive/Google Drive is the key unlock.** It eliminates the iOS eviction problem without needing Capacitor, an Apple Developer account, or any server infrastructure. You host static files, the user's data lives in their own cloud storage. This changes the calculus significantly — **Capacitor becomes optional**, not required.

3. **Ship the MVP as a PWA hosted on GitHub Pages or Cloudflare Pages** (free). Share a URL, let friends install it to their home screen, sign in with their Microsoft/Google account for backup. Total ongoing cost: $0.

4. **Don't underestimate the "electrical inventory" value** — even without live energy monitoring, having a searchable, photo-annotated map of every circuit, breaker, outlet, and load in your home is genuinely useful. Most homeowners have this information in a Sharpie-labeled panel door or not at all.

5. **The existing `DataProvider` pattern is the secret weapon.** The abstraction is already clean, the models are typed, and the NocoDB provider proves the interface works. Adding a SQLite provider is mechanical, not architectural.

6. **Keep the two modes as a build-time flag**, not a runtime toggle. This avoids shipping dead code and keeps each build lean.

---

## Decision Required

Before proceeding with implementation:

1. **Is the ~3-4 week MVP investment acceptable?**
2. **PWA-first or Capacitor-first?** (Recommendation: PWA-first)
3. **Should the AI "Ask Ohm" feature be in MVP or deferred to Phase 2?**
4. **Do you want to maintain both build targets long-term, or would you eventually migrate the homelab version to SQLite too?**

---

## References

- Existing ADR: `docs/native-ios-decision.md` — Capacitor analysis (2026-07-09)
- Existing abstraction: `src/lib/server/db/provider.ts` — DataProvider interface
- Existing demo mode: `src/lib/server/demo/` — proves app runs without external services
- [sql.js](https://github.com/nicolewd/sql.js) — SQLite compiled to WASM
- [@capacitor-community/sqlite](https://github.com/nicolewd/@nicolewd/sqlite) — Native SQLite for Capacitor
- [SvelteKit adapter-static](https://svelte.dev/docs/kit/adapter-static)
- [Capacitor](https://capacitorjs.com/) — PWA → native wrapper
