# Energy / EV mockup incorporation analysis

## Reviewed sources

- Mockup: `app/static/mockups/energy-ev-editing.html`
- Current page: `app/src/routes/energy/+page.svelte`
- Current energy components and APIs:
  - `app/src/lib/components/energy/*`
  - `app/src/routes/api/energy/*`
- Existing docs:
  - `docs/energy-integration-design.md`
  - `C:\Users\rysock\.copilot\session-state\fc7099fe-61cb-4eed-a9e8-dc7dcbac72e2\files\energy-editing-features-design.md`

---

## Executive summary

The mockup is **not just an energy page**. It is a bundled concept spanning:

1. energy monitoring,
2. EV charging,
3. live panel telemetry,
4. inline editing,
5. AI-assisted mutation,
6. location-aware home selection,
7. label printing.

The current implementation only covers the **first slice** well: live energy summary, solar, circuit ranking, capacity alerts, and setup empty states.  

Recommendation: **do not port the mockup as one tabbed mega-screen.** Instead:

- bring **energy summary + history + flow** into the Energy page,
- place **live breaker telemetry** on Panels,
- keep **editing** on Rooms/Panels,
- keep **AI write confirmation** in Ask AI/chat,
- keep **location** on Home/onboarding/settings,
- keep **labels** on Panels.

That matches the app’s current information architecture and avoids duplicating features that already exist elsewhere.

---

## 1) Mockup inventory

## Overall shell

1. **Topline/header**
   - “Electrical Config · feature concept”
   - page title
   - live/interactivity badge
2. **Home switcher**
   - `Cape House` / `Natick House`
3. **Secondary tab bar**
   - `Home`, `Flow`, `Panels`, `Editing`, `Ask AI`, `Location`, `Labels`
4. **Bottom nav**
   - `Home`, `Panels`, `Rooms`, `Ask AI`

## Home tab

5. **Energy now card**
   - solar production
   - home consumption
   - grid import/export
   - live HA badge
6. **Battery status row**
   - percent + charging state + progress bar
7. **Energy context chips**
   - solar coverage today
   - peak solar
8. **Time-range segmented control**
   - `Day`, `Week`, `Month`
9. **Daily totals row**
   - produced / consumed / exported
10. **Mini trend chart**
   - solar + load lines
11. **EV charging card**
   - charger circuit reference
   - battery target progress
   - ETA / range
   - “charging from solar” state
12. **Insights card**
   - solar coverage insight
   - export-vs-yesterday insight
   - EV solar mix insight

## Flow tab

13. **Energy flow card**
   - solar/home/grid/battery nodes
   - animated directional paths
   - export/import state badge
14. **Flow labels**
   - solar → home
   - solar → grid
   - battery charging/discharging
15. **Flow stat tiles**
   - base load
   - EV charging
   - import/export today
   - peak solar

## Panels tab

16. **Live panel overview**
   - “Main Panel · live loads”
17. **Breaker/circuit tile grid**
   - load-tier colors
   - live wattage
   - category/status tags
18. **Expanded circuit drawer**
   - normal circuit detail
   - sparkline
   - device/load summary
19. **Expanded EV circuit drawer**
   - vehicle details
   - solar/grid source mix
   - ETA / amps / kW

## Editing tab

20. **Inline edit mode entry**
   - edit CTA / edit state
21. **Editable area card**
   - room icon
   - room summary
22. **In-place form**
   - name
   - device type
   - notes
23. **Icon picker sub-surface**
   - selected icon preview
   - raw icon token
   - search field
   - recent/favorite chips
   - icon grid
24. **Edit action row**
   - cancel / save
25. **Save-success banner**
26. **Inline add-new-load card**
   - prefilled room + circuit

## Ask AI tab

27. **Prompt chips**
   - example edit commands
28. **Chat confirmation bubble**
   - detected record
   - current → new diff
   - source table
29. **Confirm / cancel actions**
30. **AI success banner**

## Location tab

31. **Location permission explainer**
   - privacy reassurance
   - allow / not now
32. **Detected-home state**
   - active home
   - distance-based status
33. **Auto-switch toast**

## Labels tab

34. **Label printing card**
35. **Label preview sheet**
   - individual breaker labels
36. **Print mode controls**
   - all circuits / selected / panel door
37. **Included-content toggles**
38. **Output actions**
   - Bluetooth print
   - PDF export
   - CSV export
39. **Panel directory preview**

---

## 2) Current state audit

## What the current Energy page already implements

### Page-level structure

- Energy page header with live/offline badge
- time-range selector (`Live`, `1H`, `24H`, `7D`, `30D`)
- loading skeleton
- empty states for:
  - Home Assistant not connected
  - no circuit mappings configured

### Live energy data

- SSE-powered live updates from `/api/energy/live`
- total watts
- utility rate
- estimated daily cost
- current solar production
- grid import/export/self-sufficient messaging
- solar today + lifetime production
- top circuit consumers
- capacity alerts
- “last update” footer

### Supporting backend already present

- `/api/energy/live`
- `/api/energy/solar`
- `/api/energy/history`
- `/api/energy/mapping`
- HA + mapping server helpers
- energy types for circuits, solar, history, cost, alerts

## Important limitations in the current Energy page

1. **Historical range switching is unfinished**
   - `onRangeChange()` explicitly has `TODO: fetch historical data for selected range`
   - the page UI exposes ranges, but only `live` works end-to-end

2. **No home scoping**
   - the mockup assumes multi-home switching
   - current energy page has no home selector and the energy endpoints are not parameterized by `homeId`

3. **No EV model**
   - no EV data types
   - no EV endpoints
   - no charger/vehicle UI on the energy page

4. **No flow visualization**
   - current page summarizes totals/cards only

5. **No panel drill-down on energy page**
   - only ranking list, not breaker grid + drawer

6. **No insights/explanations layer**
   - current alerts are threshold-based only
   - no “solar covered 87%” style summaries

7. **No battery state**
   - current energy types/API do not expose battery percentage or battery kW

## Relevant features that already exist elsewhere in the app

### Already implemented outside the Energy page

- **Location-aware home auto-selection**
  - implemented on `app/src/routes/+page.svelte`
  - backed by `app/src/lib/stores/geolocation.svelte.ts`
- **Panel label printing**
  - implemented on Panels via `PanelLabelActions.svelte`
  - includes Bluetooth printing, panel directory, label previews, PNG/PDF-oriented flows
- **Inline editing + icon picking + add load/receptacle**
  - already implemented on `app/src/routes/rooms/+page.svelte`
  - existing `IconPicker.svelte`, `QuickAddLoad.svelte`, `QuickAddReceptacle.svelte`
- **AI confirmation-before-write**
  - already implemented in chat
  - `ActionConfirmation.svelte`
  - `/api/chat/+server.ts` proposes updates and executes only after confirmation

### Implication

Several mockup sections are **already represented in the product**, just not on the Energy page.  
That means the right question is often **“should this be linked/refined?”** rather than **“should this be newly built?”**

---

## 3) Design-doc alignment

## `docs/energy-integration-design.md`

This doc aligns closely with the **current shipped energy architecture**:

- SSE live dashboard
- solar card
- top consumers
- capacity alerts
- mapping settings
- graceful degradation states

It also explicitly marks **EV integration** as a **future consideration / out of scope**.  
So this doc supports the current page, but **does not yet justify the broader mockup bundle**.

## `energy-editing-features-design.md`

This session design file aligns closely with the **new mockup**:

- energy overview widget
- EV widget
- flow visualization
- panel live loads
- inline editing
- AI edit confirmation
- location-aware auto-home selection
- label printing

This is effectively the broader product spec behind the mockup.  
However, it should be interpreted with one adjustment:

> **Keep the feature set, but distribute it across existing routes instead of collapsing it into one secondary-tab page.**

---

## 4) Gap analysis

| Mockup component | Current state | Notes |
|---|---|---|
| Home switcher | Missing on Energy page | App has home switching + geolocation on Home page, but energy route is not home-aware |
| Secondary tab bar (Home/Flow/Panels/Editing/AI/Location/Labels) | Missing | Should not be copied literally; conflicts with existing route structure |
| Energy now summary card | **Partial** | Current page has total power + solar + rate + cost, but not the mockup’s unified multi-metric card |
| Battery status | Missing | No battery data in current energy types/API |
| Day/Week/Month trend switching | **Partial** | Range selector exists, historical fetching is not wired on page |
| Produced / consumed / exported totals | Missing on page | Some data is available or derivable, but not surfaced together |
| Mini dual-line trend chart | **Partial** | Current page has sparklines, but not the mockup’s combined overview chart |
| EV charging widget | Missing | No EV endpoint or UI |
| Insights list | Missing | No explanation layer beyond alerts |
| Flow diagram | Missing | No dedicated flow UI |
| Battery node in flow | Missing | Requires battery entities/model |
| Flow stat tiles | Missing | Some metrics derivable, but not assembled |
| Live breaker tile grid | Missing on Energy page | Panels page already has breaker-centric UI; energy page only shows ranking list |
| Circuit detail drawer with sparkline | **Partial elsewhere** | Panels page already has circuit detail patterns, but not mockup’s live energy telemetry treatment |
| EV circuit detail drawer | Missing | Needs EV-specific data model |
| Inline room edit card | **Exists elsewhere** | Rooms page already supports inline editing; energy page should not duplicate |
| Icon search / picker | **Exists elsewhere** | Current picker exists, but mockup has richer MDI-focused experience |
| Inline add-new-load | **Exists elsewhere** | Quick-add exists in Rooms page |
| AI edit prompt chips | Missing as chips | Underlying AI confirmation flow exists in chat |
| AI structured confirm bubble | **Exists elsewhere** | Current chat confirmation component already implements the core pattern |
| Location permission card | **Exists elsewhere** | Home page already has this |
| Auto-switch state + toast | **Exists elsewhere** | Home page + geo store already cover this |
| Label preview + print modes | **Exists elsewhere / partial** | Panels already supports label printing, but not exactly the mockup’s “mode toggles” UI |
| PDF / CSV / Bluetooth outputs | **Partial elsewhere** | Bluetooth + preview + panel directory exist; CSV-specific export in mockup may still be missing |

---

## 5) Recommendations by component

| Component / feature | Incorporate? | Rationale | Best location | Data / APIs needed | Complexity |
|---|---|---|---|---|---|
| Unified **Energy now** card | **Yes** | Highest-value upgrade; core of the mockup and aligns with existing energy route | Energy page | Extend `/api/energy/live`; optionally add `/api/energy/overview?homeId=` | Medium |
| Home selector on energy surfaces | **Yes, later** | Useful for multi-home, but backend is not scoped by home yet | Shared app-level state + Energy page header | home-aware energy aggregation, `homeId` propagation | Large |
| Historical **Day / Week / Month** views | **Yes** | UI already advertises ranges; current TODO should be completed | Energy page | Finish `/api/energy/history` consumption; possibly add aggregated totals | Medium |
| Produced / consumed / imported / exported totals | **Yes** | Strong utility value and easy to understand | Energy page | aggregated history endpoint or enriched solar/history response | Medium |
| Combined overview chart | **Yes** | Makes the page feel materially closer to the mockup | Energy page | chart-ready history for production + consumption + net | Medium |
| Battery status | **Later** | Valuable if a battery exists, but not universal | Energy page / Flow detail | battery HA entities + config + types | Large |
| Insights list | **Yes** | Adds meaning, not just raw telemetry; matches session design | Energy page | computed summaries from live/history data | Medium |
| Energy flow diagram | **Yes** | Distinctive, high-value energy-specific view | Energy page (detail section or subview) | solar, home load, grid import/export; optional battery entity | Medium |
| Battery node in flow | **Later** | Only if battery telemetry exists | Energy flow detail | battery entities + charge/discharge logic | Large |
| EV charging widget | **Yes, later** | Strong value, but requires entirely new data source and mapping | Energy page (below energy summary) | `/api/ev/status`, EV/charger/home mapping, HA EV entities | Large |
| EV solar-vs-grid attribution | **Yes, later** | Excellent insight, but depends on robust EV + energy attribution logic | EV widget + panel EV drawer | EV charge rate + solar surplus/base-load math | Large |
| Live breaker tile grid | **Yes, but not on Energy page** | Valuable, but belongs on Panels where breaker context already exists | Panels page | existing circuit mappings + live SSE + panel grouping | Medium |
| Circuit detail sparkline | **Yes** | Natural enhancement of Panels; reuses existing route patterns | Panels page | `/api/energy/history?circuit_id=` | Medium |
| EV-specific breaker drawer | **Yes, later** | High value once EV data exists | Panels page | EV-charger-to-circuit mapping + EV endpoint | Large |
| Inline room edit card | **No (for Energy page)** | Already exists on Rooms; avoid duplication | Rooms page | existing NocoDB PATCH flows | Small polish |
| Richer icon picker (recent/favorites/raw token emphasis) | **Yes, later** | Good UX improvement to existing editing, but not an energy-page feature | Rooms page / shared editor | existing picker + optional local recent/favorite state | Medium |
| Inline add-new-load card | **No (for Energy page)** | Already exists in Rooms; should stay room-scoped | Rooms page | existing quick-add APIs | Small polish |
| AI prompt chips for common edit tasks | **Later** | Helpful discoverability, but chat already supports confirmation flow | Ask AI page / bottom sheet | existing `/api/chat` + prefilled prompts | Small |
| AI structured confirmation bubble | **Already done** | Existing pattern matches the mockup conceptually | Ask AI/chat | existing chat confirmation | Done |
| Location permission / detected-home UI | **No new energy-page work** | Already implemented and belongs at app/home level | Home page + settings | existing geolocation store | Done / small polish |
| Label printing surface | **No new energy-page work** | Already fits Panels better than Energy | Panels page | existing printer services | Done / medium polish |
| CSV export for labels | **Later** | Useful for interoperability, but lower priority than energy/EV core | Panels page label tools | label export formatter | Medium |

---

## 6) Recommended product decisions

## A. What should move onto the Energy page

These are the mockup elements that truly belong on the Energy page:

- unified energy summary card
- real historical range behavior
- daily/weekly/monthly totals
- insight list
- energy flow detail
- later: EV summary widget

## B. What should stay on other routes

These mockup ideas are good, but should **not** be incorporated into the Energy page itself:

- breaker grid + circuit drawers → **Panels**
- inline room/load editing → **Rooms**
- AI edit confirmations → **Ask AI/chat**
- location consent/auto-home → **Home / onboarding / settings**
- label printing → **Panels**

## C. What should be treated as cross-cutting infrastructure

- home-aware energy aggregation
- EV/charger/circuit mapping
- battery entity support
- reusable insight-generation service

---

## 7) Phased plan

## Phase A — quick wins for the Energy page

These improve the page immediately without changing the app’s route structure.

1. **Finish historical range support**
   - wire `1H / 24H / 7D / 30D` to `/api/energy/history`
   - replace the current `TODO`
2. **Reshape the top of the page into a unified energy summary**
   - combine total load, solar, grid state, rate, and cost into one stronger hero card
3. **Add daily totals**
   - produced, consumed, imported/exported
4. **Add lightweight insights**
   - solar coverage today
   - top load since a recent window
   - monitoring gaps / partial-data notices
5. **Improve stale/partial/offline states**
   - explicit freshness/status language instead of only live/offline

Why Phase A:

- most of the backend foundation already exists
- it closes obvious UX gaps in the current route
- it brings the energy page much closer to the mockup without overextending scope

## Phase B — medium-effort features with strong user value

1. **Energy flow detail surface**
   - solar / home / grid now
   - optional battery placeholder only if absent
2. **Panels live-load enhancement**
   - breaker tinting by load tier
   - per-circuit live wattage badge
   - sparkline in circuit detail
3. **Refine insights engine**
   - comparison vs yesterday
   - peak windows
   - top-consumer share
4. **Upgrade existing editing surfaces**
   - richer icon picker
   - better success/error states
   - prefilled quick-add polish
5. **Add AI prompt chips in Ask AI**
   - convenience, not new architecture

Why Phase B:

- high visible value
- mostly additive
- leverages current routes rather than fighting them

## Phase C — larger features needing backend/data work

1. **EV integration**
   - new EV endpoint
   - Rivian/charger/home/circuit mapping
   - source-mix attribution
2. **Home-aware energy scoping**
   - all energy APIs accept `homeId`
   - UI selector shared across routes
3. **Battery integration**
   - battery entities, charge/discharge state, flow node
4. **EV breaker enrichment**
   - special panel drawer with vehicle state
5. **Label export expansion**
   - CSV or other external printer formats if still needed

Why Phase C:

- depends on new data sources, mapping rules, or house-level aggregation
- significantly more validation and failure-state work

---

## 8) Recommended implementation stance

## Incorporate now

- energy summary overhaul
- history/totals
- insights
- flow view
- panel live-load enhancements on Panels

## Incorporate later

- EV widget
- EV source attribution
- battery-aware flow
- home-aware multi-property energy switching
- richer label export formats

## Do not incorporate literally

- the mockup’s full secondary-tab mega-page
- editing/location/labels duplicated inside the Energy page

---

## 9) Final recommendation

Use the mockup as a **feature-direction document**, not a literal page blueprint.

The right plan is:

1. **upgrade the Energy page** with better summary, history, insights, and flow,
2. **upgrade Panels** with live breaker telemetry,
3. **reuse existing Rooms / Ask AI / Home / Panels capabilities** instead of cloning them into Energy,
4. **treat EV as a separate backend-backed feature phase**, not as a small UI addition.

That gives the project the value of the mockup while preserving the current product architecture.
