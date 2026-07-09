# Electrical Config AI — Project Status & Roadmap

> Last updated: 2026-07-06

## Feature Status Overview

| Feature | Status | Design Doc | Branch/PR |
|---------|--------|-----------|-----------|
| AI Chat | ✅ Phase 1 Complete | `ai-chat-design.md` | PR #511 (merged) |
| Home Assistant | ✅ Phase 3a-3b Complete | `home-assistant-integration-design.md` | PR #515 (merged) |
| Energy Integration | ✅ Phase 5a Complete | `energy-integration-design.md` | PR #512 (merged) |
| UniFi API | ✅ Phase 1 Complete | `unifi-integration-design.md` | PR #510 (merged) |
| AR Panel View | ✅ Phase 1 MVP Complete | `ar-mode-design.md` | PR #514 (merged) |
| Label Printing | ✅ Phase 1-3 Complete | `label-printing-design.md` | PR #513 (merged) |

---

## 1. AI Chat

### ✅ Delivered
- Streaming SSE chat with `/api/chat` route
- 5 sub-components: MessageBubble, DataCard, ActionConfirmation, SuggestionChips, TypingIndicator
- Tool calling via Open-WebUI: `query_electrical_data`, `search`, `propose_update`
- Action confirmation flow with diff preview before writes
- Chat store with Svelte 5 runes + localStorage persistence
- Backward-compatible `/api/ask` for Siri Shortcuts

### ❌ Outstanding
- **Deep link rendering** — `[link:/panels?panel=123]` markers in AI responses should render as clickable navigation
- **View-context awareness** — Chat should know current page/panel/room context for relevant responses
- **Cross-feature tools** — Chat can't yet query energy data, HA entities, or UniFi devices

### 🔮 Future
- Voice input within app (speech-to-text, not just Siri bridge)
- Multi-user chat history (server-side persistence)
- Proactive suggestions ("Circuit 7 is at 80% capacity")

---

## 2. Home Assistant Integration

### ✅ Delivered
- **PWA Side**: REST client (`ha-client.ts`), API routes (`/api/ha`, `/api/ha/entities`, `/api/ha/control`)
- **Custom HA Integration**: `custom_components/nocodb_electrical/` — config_flow, sensor.py, services.yaml
- **Config Examples**: `ha-config/configuration.yaml.example`, `ha-config/automations.yaml.example`
- **Settings UI**: Connection status, feature list, test button

### ❌ Outstanding
- **binary_sensor.py** — GFCI/AFCI status as binary sensors (noted "future" in code)
- **strings.json** — UI localization for the HA integration
- **NocoDB webhooks (Phase 3c)** — Bidirectional sync when NocoDB records change
- **Z-Wave entity ↔ circuit mapping (Phase 3c)** — Linking HA Z-Wave devices to NocoDB circuits
- **WebSocket real-time** — Currently REST-only; WebSocket for live state in PWA

### 🔮 Future
- Energy cost tracking (pull utility rates, calculate per-circuit costs)
- Automation templates (trip detection, capacity alerts)
- Voice assistant: "Hey Siri → PWA → HA" chain
- Multi-panel Lovelace dashboard card

---

## 3. Energy Integration

### ✅ Delivered
- SSE live stream (`/api/energy/live`) — ~1s real-time power updates
- History endpoint (`/api/energy/history`) — 1h/24h/7d/30d ranges
- Enphase solar endpoint (`/api/energy/solar`) — production + daily totals
- Entity mapping (`/api/energy/mapping`) with auto-discovery
- 5 UI components: PowerGauge, CircuitRanking, SolarCard, TimeRangeSelector, CostEstimate
- Energy dashboard page at `/energy`
- Entity mapping settings at `/settings/energy`
- ⚡ Energy tab in bottom nav

### ❌ Outstanding
- **Real HA connection** — Requires configured HA_URL + HA_TOKEN with Emporia Vue integration running
- **Entity mapping validation** — Auto-discovery needs real Emporia Vue entities to verify
- **Net power calculation** — consumption - solar (formula ready, needs real data)
- **Cost estimate accuracy** — Needs utility rate configuration validated against actual bills

### 🔮 Future (Phases 5b-5d)
- **Phase 5b: Device Control** — Smart device on/off toggle, live state via HA WebSocket
- **Phase 5c: Smart Insights** — Anomaly detection, waste detection, capacity warnings
- **Phase 5d: Historical Analytics** — Per-circuit charts, cost breakdown, month-over-month
- Time-of-use rate plans
- Per-panel microinverter production (Enphase)
- EV charger integration / load management

---

## 4. UniFi API

### ✅ Delivered
- Full REST client with cookie auth + auto-reauth on 401
- API routes: `/api/unifi/{test,devices,clients,poe/[mac],sites,sync}`
- Settings UI: URL, credentials, site selector, test connection, sync button
- MAC-based device sync to NocoDB (`Network_Match_Key` → `Network_Role` + `Power_Source`)
- POE budget endpoint: per-port wattage and utilization
- Config module with env fallback (same pattern as `ai-config.ts`)

### ❌ Outstanding
- **Scheduled/automatic sync** — Currently manual "Sync" button only; no periodic or event-driven sync
- **POE visualization** — POE budget data exists but isn't displayed in panel/rooms views
- **Device status indicators** — Could show online/offline in the floorplan markers

### 🔮 Future
- WebSocket subscription for real-time device state changes
- UniFi Protect integration (cameras)
- VLAN topology visualization
- Alert rules (device offline, POE overload)
- Historical POE power graphing

---

## 5. AR Panel View

### ✅ Delivered (Phase 1 MVP)
- Full-screen camera overlay using `getUserMedia` (rear camera preference)
- Grid overlay positioned by circuit slot numbers
- Color-coded utilization dots: green (<60%), amber (60-80%), red (>80%)
- Tap-to-inspect bottom sheet with circuit details, loads, badges
- Alignment guide with corner markers and lock button
- Torch/flashlight toggle for dark environments
- Calibration persistence per panel (localStorage)
- Graceful camera error handling

### ❌ Outstanding (Phase 2)
- **QR code triggers** — Generate printable QR per panel; scanning auto-selects panel + enters AR
- **Calibration refinement** — Corner-drag or pinch-to-scale for better physical alignment
- **Multi-panel detection** — If multiple panels are visible, identify which is which

### 🔮 Future (Phase 3)
- Native ARKit with LiDAR (Capacitor plugin wrapping ARKit)
- 3D circuit tracing (visualize wire runs in AR space)
- Only if user base grows beyond personal use

---

## 6. Label Printing

### ✅ Delivered (Phases 1-3)
- Canvas-based label renderer (panel directory, circuit, device labels)
- ESC/POS raster mode command builder
- Web Bluetooth Phomemo connection (service 0xFFE0, write 0xFFE1)
- Chunked BLE transmission with auto-reconnect
- PDF/PNG fallback (system print dialog)
- Label preview modal with BLE/PDF print actions
- Panel view integration: "Print Directory" / "Print All" / "Download" buttons
- TypeScript interfaces for all label/printer types
- Phomemo label size presets (40mm, 50mm, etc.)

### ❌ Outstanding
- **QR code generation** — QR combo labels (link to app + circuit info) — `qrcode` package may need wiring
- **Batch printing validation** — "Print All" sequential BLE transmission untested with real hardware
- **Physical device testing** — BLE protocol spec'd but needs Phomemo M110/M120 validation
- **Wire color indicators** — Labels don't yet show expected wire colors

### 🔮 Future
- NFC tap-to-print
- Template editor (user-customizable label layouts)
- Label history tracking (what's been printed)
- Bulk CSV → label sheet export for entire home

---

## Cross-Feature Integration Gaps

| Gap | Description | Effort |
|-----|-------------|--------|
| AI Chat ↔ Energy | Chat can't query "how much is kitchen using?" | Add energy tool to chat |
| AI Chat ↔ HA | Chat can't control devices or show live state | Add HA tool to chat |
| AI Chat ↔ UniFi | Chat can't answer "is the AP online?" | Add UniFi tool to chat |
| AR ↔ Labels | QR codes for AR triggers could be printed by label system | Connect label QR → AR scanner |
| UniFi POE ↔ Panel View | POE data exists but not shown in panel UI | Add POE column/badge |
| Energy ↔ HA dependency | Energy dashboard is non-functional without HA running | Document prerequisite clearly |
| No setup wizard | User must configure 4 separate .env sections manually | Add first-run guided setup |

---

## Environment Configuration Required

```env
# NocoDB (required for all features)
NOCODB_URL=http://nocodb.socko.us
NOCODB_API_TOKEN=<token>
NOCODB_BASE_ID=<base-id>

# AI Chat (Open-WebUI)
OPENWEBUI_URL=http://openwebui.socko.us
OPENWEBUI_KEY=<api-key>
OPENWEBUI_MODEL=<model-name>

# Home Assistant
HA_URL=http://homeassistant.local:8123
HA_TOKEN=<long-lived-access-token>

# Energy (via Home Assistant entities)
HA_EMPORIA_PREFIX=sensor.emporia_vue_
HA_ENPHASE_PRODUCTION_ENTITY=sensor.enphase_current_power_production
HA_ENPHASE_TODAY_ENTITY=sensor.enphase_today_s_energy_production
UTILITY_RATE_KWH=0.12

# UniFi Network
UNIFI_URL=https://192.168.1.1
UNIFI_USERNAME=<admin-user>
UNIFI_PASSWORD=<password>
UNIFI_SITE=default
UNIFI_VERIFY_SSL=false
```

---

## Priority Recommendations

### High Value / Low Effort
1. **Cross-feature chat tools** — Add energy/HA/UniFi query tools to AI chat (1-2 days)
2. **UniFi auto-sync** — Periodic sync on a timer or on settings page load (hours)
3. **AR QR codes via Label Printing** — Generate QR → scan triggers AR mode (1 day)

### High Value / Medium Effort
4. **HA Phase 3c: Bidirectional linking** — NocoDB webhooks + Z-Wave mapping (1 week)
5. **Energy Phase 5b: Device control** — Toggle smart devices from energy dashboard (3 days)
6. **Setup wizard** — Guided first-run configuration (2-3 days)

### Lower Priority / Higher Effort
7. **Energy Phase 5c-5d** — Insights + historical analytics (1-2 weeks)
8. **AR Phase 2: QR triggers** — Generate + scan QR for panel selection (3 days)
9. **AR Phase 3: Native ARKit** — Only if use case expands (4-6 weeks)
