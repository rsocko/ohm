# AR Mode Design — Phase 4c

## Overview

AR Mode enables users to overlay circuit information directly onto their physical breaker panel through their phone's camera. Standing in front of the panel, users see real-time labels, amp ratings, load counts, and utilization indicators on each breaker position.

---

## Approach Evaluation

### Approach A: Native ARKit + LiDAR

**Description:** Use iPhone 16 Pro's LiDAR scanner via ARKit for precise spatial anchoring of overlays in 3D space.

| Aspect | Details |
|--------|---------|
| **Precision** | Excellent — sub-centimeter accuracy with LiDAR |
| **Tracking** | Full 6DoF, overlays stay anchored as user moves |
| **Requirements** | Native Swift/SwiftUI app or Capacitor plugin |
| **Browser support** | None — requires native code |
| **Effort** | 4–6 weeks (native iOS development) |
| **Maintainability** | Separate codebase from PWA |

**Pros:**
- Best visual experience — overlays track perfectly
- LiDAR works in low light (garage/basement friendly)
- Can detect panel surface geometry

**Cons:**
- Breaks PWA model — requires native app or Capacitor wrapper
- iPhone-only (no Android, no desktop)
- Significant development and maintenance overhead
- App Store review process

---

### Approach B: WebXR

**Description:** Use the WebXR Device API for browser-based AR with hit-testing and anchored overlays.

| Aspect | Details |
|--------|---------|
| **Precision** | Moderate — depends on device AR capabilities |
| **Tracking** | 3DoF minimum, 6DoF on supported devices |
| **Requirements** | WebXR-compatible browser |
| **Browser support** | Chrome Android: Good. Safari iOS: Experimental/limited |
| **Effort** | 2–3 weeks |
| **Maintainability** | Shared web codebase |

**Pros:**
- Standards-based, no native code
- Works on Android Chrome with ARCore
- Progressive enhancement possible

**Cons:**
- Safari iOS support is very limited (no immersive-ar session)
- Primary user has iPhone — this approach doesn't work well
- No LiDAR access from WebXR on iOS
- Inconsistent experience across devices

---

### Approach C: Camera + Template Overlay (★ Recommended MVP)

**Description:** Open the rear camera as a full-screen background, overlay a positioned grid of circuit labels based on known panel dimensions and slot layout. No spatial tracking — user manually aligns their phone to frame the panel.

| Aspect | Details |
|--------|---------|
| **Precision** | Good — user aligns once, overlay is static |
| **Tracking** | None — fixed overlay on camera feed |
| **Requirements** | `getUserMedia` API (universal) |
| **Browser support** | All modern browsers including Safari PWA |
| **Effort** | 3–5 days |
| **Maintainability** | Pure web, same SvelteKit codebase |

**Pros:**
- Works in Safari PWA on iPhone — critical for this project
- Zero external dependencies
- Leverages existing slot/circuit data from NocoDB
- Fast to implement and iterate
- Offline-capable (camera + cached data)
- Works on any device with a camera

**Cons:**
- No spatial tracking — overlay doesn't move with camera
- User must hold phone steady, aligned with panel
- Less "magical" than true AR
- Panel alignment requires initial calibration step

---

### Approach D: QR/NFC Markers (Hybrid)

**Description:** Place a QR code or NFC tag on/near the panel. Scanning triggers the AR overlay with panel-specific data. Combines easy panel identification with template-based overlay.

| Aspect | Details |
|--------|---------|
| **Precision** | Same as Approach C after scan |
| **Tracking** | None — template overlay |
| **Requirements** | QR: camera; NFC: NFC-capable device |
| **Browser support** | QR: universal; NFC: limited web support |
| **Effort** | 1–2 days (addon to Approach C) |
| **Maintainability** | Minimal additional code |

**Pros:**
- Instant panel identification (no manual selection)
- Could encode panel dimensions in QR for calibration
- Great for multi-panel homes
- NFC works even with screen off on iPhone

**Cons:**
- Requires printing/placing physical markers
- Adds setup friction for first-time use
- QR scanning is a separate step before overlay
- NFC web support is very limited

---

## Recommendation: Phased Rollout

### Phase 1 (MVP): Approach C — Camera + Template Overlay
- Implement immediately as a SvelteKit component
- Full-screen camera with positioned overlay grid
- Manual panel selection (from existing panel list)
- Alignment guide for user calibration
- Ship in days, not weeks

### Phase 2 (Enhancement): Add QR triggers (Approach D)
- Generate QR codes per panel (printable from app)
- Scanning auto-selects panel and enters AR mode
- Optional — users who don't want to print QR continue with manual selection

### Phase 3 (Future): Native ARKit (Approach A)
- Only if user base grows beyond personal use
- Capacitor plugin wrapping ARKit for LiDAR-based tracking
- Significantly better experience but high effort

---

## UX Flow — MVP (Approach C)

```
┌─────────────────────────────────────────────────────┐
│  Panels Page (existing)                             │
│  ┌─────────┐ ┌──────────┐ ┌─────────┐             │
│  │Schematic│ │  Photo   │ │ AR View │← NEW        │
│  └─────────┘ └──────────┘ └─────────┘             │
└────────────────────────────┬────────────────────────┘
                             │ tap "AR View"
                             ▼
┌─────────────────────────────────────────────────────┐
│  AR Mode — Alignment                                │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │                                               │  │
│  │         📷  Camera Feed (rear)                │  │
│  │                                               │  │
│  │    ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐       │  │
│  │    │   Alignment Frame (dashed)       │       │  │
│  │    │   "Align your panel to this      │       │  │
│  │    │    frame, then tap to lock"      │       │  │
│  │    └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘       │  │
│  │                                               │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  [✕ Close]                        [Lock Alignment]  │
└─────────────────────────────────────────────────────┘
                             │ tap "Lock Alignment"
                             ▼
┌─────────────────────────────────────────────────────┐
│  AR Mode — Active Overlay                           │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  📷 Camera Feed                              │  │
│  │  ┌──────────┬──────────┐                      │  │
│  │  │ 1  40A   │ 2  30A   │  ← Overlay grid     │  │
│  │  │ Range 🟢 │ Dryer 🟢 │                      │  │
│  │  ├──────────┼──────────┤                      │  │
│  │  │ 3  15A   │ 4  15A   │                      │  │
│  │  │ MBed 🟢  │ MBath 🟢 │                      │  │
│  │  ├──────────┼──────────┤                      │  │
│  │  │ 5  20A   │ 6  20A   │                      │  │
│  │  │ Kitch 🟡 │ Garage🟢 │                      │  │
│  │  ├──────────┼──────────┤                      │  │
│  │  │ 7  15A   │ 8  15A   │                      │  │
│  │  │ Living🟢 │ Office🟢 │                      │  │
│  │  └──────────┴──────────┘                      │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  [✕ Close]              [🔍 Legend] [⚙ Calibrate]   │
└─────────────────────────────────────────────────────┘
                             │ tap a breaker cell
                             ▼
┌─────────────────────────────────────────────────────┐
│  Bottom Sheet — Circuit Detail                      │
│  ┌───────────────────────────────────────────────┐  │
│  │  Circuit 5 — Kitchen Counter        20A GFCI  │  │
│  │                                               │  │
│  │  Utilization: ████████░░ 72%  🟡 High         │  │
│  │                                               │  │
│  │  Loads (4):                                   │  │
│  │  • Microwave (1200W)                          │  │
│  │  • Coffee Maker (900W)                        │  │
│  │  • Toaster (800W)                             │  │
│  │  • Blender (400W)                             │  │
│  │                                               │  │
│  │  Receptacles: 4 GFCI outlets                  │  │
│  │  Area: Kitchen                                │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Color Coding

| Color | Utilization | Meaning |
|-------|-------------|---------|
| 🟢 Green | < 60% | Normal — well within capacity |
| 🟡 Amber | 60–80% | Elevated — monitor for additions |
| 🔴 Red | > 80% | Overloaded — review or redistribute |
| ⚪ Gray | Unknown | No wattage data available |

### Utilization Calculation

```
utilization = (sum of connected load wattages) / (circuit_amps × voltage × 0.8)
```

The 0.8 factor accounts for NEC continuous load derating (80% rule).

---

## Data Model Additions

### Panel Table — New Fields

| Field | Type | Description |
|-------|------|-------------|
| `Slot_Columns` | Integer | Number of breaker columns (typically 2) |
| `Slot_Rows` | Integer | Number of breaker rows per column |
| `Panel_Width_Inches` | Decimal | Physical width of breaker area |
| `Panel_Height_Inches` | Decimal | Physical height of breaker area |
| `AR_Calibration_JSON` | LongText | Saved calibration offsets (grid top/bottom %) |

### Circuit Table — Existing Fields Used

The existing `Number` field (slot number) already provides position mapping. Double-pole breakers occupy consecutive slots (e.g., 1/3). Tandem breakers share a slot with position suffix.

No new circuit fields needed — current schema sufficient.

---

## Calibration Strategy

### Initial Setup (per panel)
1. User enters AR mode for first time on a panel
2. App shows alignment frame sized to panel's aspect ratio (from `Slot_Rows` × `Slot_Columns`)
3. User frames their panel within the guide
4. User taps "Lock" — overlay appears
5. Fine-tune: drag grid overlay to align with physical breakers
6. Save calibration (stored in NocoDB `AR_Calibration_JSON` or localStorage)

### Subsequent Uses
- Saved calibration recalled automatically
- User can re-calibrate via ⚙ button
- If panel dimensions change, prompt re-calibration

### Alignment Approach
- The grid overlay uses `gridTopPct` and `gridBottomPct` (already in the photo view code!) to position breaker labels
- Extend this to AR view — same grid computation, different background (camera vs. photo)

---

## Offline Considerations

- Camera access works offline (device-local)
- Panel/circuit data cached in IndexedDB via existing `dataStore` offline system
- Calibration saved in localStorage (immediate access)
- Full AR mode works completely offline once data is cached
- Service Worker ensures the component JS/CSS is available

---

## Technology Choices

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Camera access | `navigator.mediaDevices.getUserMedia` | Universal, PWA-compatible |
| Video element | `<video>` with `playsinline` | Required for iOS inline playback |
| Overlay positioning | CSS Grid + absolute positioning | Simple, performant, no layout thrash |
| Bottom sheet | Existing slide transition pattern | Consistent with app UX |
| State management | Svelte 5 runes (`$state`, `$derived`) | Matches existing codebase |
| Icons | Iconify (`@iconify/svelte`) | Already in use |
| Animations | CSS transitions (per UI polish principles) | Specific properties, no `transition: all` |

---

## Component Architecture

```
PanelARView.svelte
├── Camera layer (<video> fullscreen background)
├── Overlay layer (absolute positioned grid)
│   ├── Alignment frame (shown during calibration)
│   ├── Breaker cells (one per slot)
│   │   ├── Circuit number badge
│   │   ├── Amp rating
│   │   ├── Short name
│   │   └── Status indicator (color dot)
│   └── Legend overlay (togglable)
└── Detail sheet (bottom sheet on tap)
    ├── Circuit name + type badges
    ├── Utilization bar
    ├── Connected loads list
    └── Receptacle count
```

### Props Interface

```typescript
interface PanelARViewProps {
  panel: V3Record;           // Panel record with dimensions
  circuits: V3Record[];      // Circuits for this panel
  loads: V3Record[];         // All loads (for utilization calc)
  receptacles: V3Record[];   // All receptacles
  onClose: () => void;       // Exit AR mode callback
}
```
