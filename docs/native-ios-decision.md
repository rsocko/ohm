# Architecture Decision Record: Native iOS vs. PWA + Home Assistant

## Date

2026-07-09

## Status

**Decided** — Stay with PWA + Home Assistant Companion app widgets for now. Revisit if Live Activities or custom widget UX becomes a priority.

---

## Context

Ohm is a SvelteKit PWA with offline support, live energy monitoring via Home Assistant SSE, and a NocoDB-backed circuit topology model. The question: should we wrap the PWA in a native iOS shell (via Capacitor) to access platform features like widgets, Live Activities, and Siri — or can we achieve most of the same outcomes through the existing Home Assistant Companion iOS app?

Key facts:
- Energy data (solar, grid, EV charging, per-circuit usage) originates from Home Assistant sensors
- The Ohm HA integration (`nocodb_electrical`) syncs circuit topology back to HA as entities
- The HA Companion iOS app already supports WidgetKit, Siri Shortcuts, and push notifications
- Ohm is a personal/household tool, not a commercial product

---

## Options Evaluated

### Option A: Capacitor Native Wrapper

Wrap the existing SvelteKit PWA in [Capacitor](https://capacitorjs.com/) (MIT licensed, free) to produce a native iOS app with access to platform APIs.

**What this enables:**

| Feature | Description |
|---------|-------------|
| **WidgetKit (Home Screen Widgets)** | Custom SwiftUI widgets showing Ohm's energy flow diagram, circuit rankings, or solar/consumption gauges in Ohm's design language |
| **Live Activities (Dynamic Island)** | Show EV charging progress, solar peak tracking, or active high-load alerts in the Dynamic Island and lock screen |
| **App Intents / Siri** | "Hey Siri, which circuit is the kitchen on?" using Ohm's topology model — richer answers than raw HA entity states |
| **Background App Refresh** | Keep IndexedDB cache fresh proactively; pre-fetch energy history so the app opens instantly with current data |
| **Haptic Feedback** | Confirm circuit edits, alert acknowledgment (iOS Safari doesn't support `navigator.vibrate()`) |
| **App Clips** | An electrician could scan a QR on the panel to view topology without installing the full app |

**Costs:**

| Cost | Detail |
|------|--------|
| Apple Developer Program | $99/year |
| Adapter change | Must switch from `adapter-auto` to `adapter-static` (no SSR/server routes inside native shell) |
| Two deployment targets | Maintain both hosted PWA and App Store build |
| Swift code for widgets | WidgetKit extensions are pure SwiftUI — separate language and build system |
| Build tooling | Requires Xcode, CocoaPods/SPM, iOS Simulator, macOS CI runner |
| Maintenance burden | Two languages (TypeScript + Swift), two build pipelines for a household tool |

---

### Option B: PWA + Home Assistant Companion App (Recommended)

Keep Ohm as a pure PWA. Use the HA Companion iOS app — which already has native platform access — for glanceable widgets, notifications, and Siri integration.

**What HA Companion already provides (for free, today):**

| Feature | How It Works | Example |
|---------|-------------|---------|
| **Home Screen Widgets** | Display any HA entity state in small/medium/large widget sizes | `sensor.solar_production` → "Solar: 4.2 kW" |
| **Quick Actions** | Tap widget to run HA scripts/automations | "Turn off EV charger," "Goodnight scene" |
| **Push Notifications** | HA automations → `notify.mobile_app_*` service | Capacity alerts, breaker trip detection, solar anomalies |
| **Siri Shortcuts** | Expose HA scripts as iOS Shortcuts | "Hey Siri, what's my solar producing?" → reads sensor state |
| **Presence/Geofencing** | Built-in device tracker | Auto-arm security when leaving, adjust HVAC |
| **Critical Alerts** | Bypass Do Not Disturb for safety events | Smoke detector, water leak, breaker overload |
| **Actionable Notifications** | Buttons in notification banners | "Breaker 14 high load — Tap to view in Ohm" (opens PWA) |

**What HA Companion cannot do:**

| Gap | Why |
|-----|-----|
| **Live Activities / Dynamic Island** | Not implemented in HA Companion app |
| **Custom widget design** | Widgets show entity state as text/icon — no flow diagrams or Ohm-branded UI |
| **Topology-aware Siri** | Siri can read entity states but can't reason about "which circuit serves the kitchen" without custom App Intents |
| **Haptics on edit** | Web-only limitation remains |

---

## Decision

**Option B: PWA + Home Assistant Companion app.**

The energy data already lives in Home Assistant. The Companion app gives us native widgets, Siri, and notifications without maintaining a separate native codebase. For a personal household tool, the marginal value of Live Activities and custom widget UI doesn't justify the overhead of a Capacitor wrapper today.

---

## Rationale

1. **90% of the "native iOS" value is already available** through HA Companion widgets showing solar, consumption, EV charging, and alert states.
2. **Zero additional code** for widgets/Siri — just configure HA automations and expose scripts as Shortcuts.
3. **Ohm's strengths are in the full app experience** (topology browsing, AI chat, AR mode, energy flow diagrams) — these require the full PWA, not a widget-sized surface.
4. **Capacitor is non-destructive** — it can be bolted on later without rewriting the PWA. This decision is easily reversible.
5. **Maintenance cost matters** — Swift widget code + Xcode builds + App Store review cycle is high overhead for one household.

---

## Future Triggers to Revisit

Reconsider the Capacitor path if any of these become true:

| Trigger | What It Unlocks |
|---------|----------------|
| EV charging sessions feel incomplete without Dynamic Island progress | Live Activities |
| You want a mini energy flow diagram on the home screen (not just numbers) | Custom WidgetKit with SwiftUI |
| You want "which circuit is X on?" via Siri without opening the app | Custom App Intents with Ohm's topology model |
| Ohm becomes a product shared with other households | App Store distribution, onboarding via App Clips |
| HA Companion adds Live Activities support | Removes the biggest gap — may eliminate need entirely |

---

## Implementation: Maximizing HA Companion for Ohm

### Recommended HA Widgets to Set Up

| Widget | Size | Entity | Purpose |
|--------|------|--------|---------|
| Solar Now | Small | `sensor.solar_production` | Current solar output in kW |
| Home Consumption | Small | `sensor.grid_consumption` | Current grid draw |
| EV Charging | Medium | `sensor.ev_charger_power` + `sensor.ev_battery_level` | Charging status at a glance |
| Energy Balance | Medium | Template sensor (solar - consumption) | Net import/export |
| Panel Load | Small | `sensor.main_panel_load_percent` | Capacity utilization % |

### Recommended Siri Shortcuts

| Shortcut Phrase | HA Script Action |
|-----------------|-----------------|
| "What's my solar producing?" | Read `sensor.solar_production` state via Shortcuts |
| "Is the EV charging?" | Read `sensor.ev_charger_status` |
| "Turn off the EV charger" | Call `switch.ev_charger` → off |
| "Open electrical map" | Open Ohm PWA URL via Shortcuts |

### Recommended Notification Automations

| Trigger | Notification | Category |
|---------|-------------|----------|
| Any circuit > 80% rated amperage for 5+ min | "⚡ Circuit 14 (Kitchen) at 82% capacity" | Warning |
| Solar production drops to 0 during daylight | "☁️ Solar offline — check inverter" | Alert |
| EV charging complete | "🔋 EV charged to 90% — cost: $3.40" | Info |
| Total home draw > main breaker 80% | "🚨 Main panel at 83% — consider shedding load" | Critical |
| NocoDB sync failure | "⚠️ Ohm data sync failed — check NocoDB" | System |

### Deep Link from HA → Ohm PWA

Configure notification actions to open Ohm directly to relevant views:

```yaml
# Example HA automation notification with Ohm deep link
- service: notify.mobile_app_your_phone
  data:
    title: "⚡ High Load Alert"
    message: "Circuit 14 (Kitchen) at 82% capacity"
    data:
      url: "https://ohm.example.com/panels/1/circuits/14"
      actions:
        - action: URI
          title: "View in Ohm"
          uri: "https://ohm.example.com/energy"
```

---

## References

- [Capacitor](https://capacitorjs.com/) — MIT licensed, free
- [HA Companion iOS Widgets](https://companion.home-assistant.io/docs/apple-watch/apple-watch/)
- [HA Companion Notifications](https://companion.home-assistant.io/docs/notifications/notifications-basic/)
- [HA Siri Shortcuts](https://companion.home-assistant.io/docs/integrations/siri-shortcuts/)
- [Apple WidgetKit](https://developer.apple.com/documentation/widgetkit)
- [Apple Live Activities](https://developer.apple.com/documentation/activitykit)
