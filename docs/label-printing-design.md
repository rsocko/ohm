# Label Printing — Phomemo Integration Design

## Overview

Add label printing capabilities to the Electrical Config AI PWA, enabling thermal label generation from panel/circuit/device data via a Bluetooth-connected Phomemo printer or PDF fallback.

---

## 1. Label Types & Specifications

### 1.1 Panel Directory Label

Full panel schedule printed as a single label for the breaker panel door.

```
┌─────────────────────────────────────────────┐
│           MAIN PANEL • 200A                 │
├──────────────────────┬──────────────────────┤
│  1  Kit Counter GFCI │  2  Dishwasher       │
│     20A GFCI         │     20A Dedicated    │
│  3  Living Room      │  4  Master Bed       │
│     15A AFCI         │     15A AFCI         │
│  5  Hall Bath        │  6  Office           │
│     20A GFCI         │     15A AFCI         │
│  7  Garage           │  8  Laundry          │
│     20A              │     20A Dedicated    │
│  9  AC Compressor    │ 10  Dryer            │
│     30A 2-pole       │     30A 2-pole       │
│ ...                  │ ...                  │
├──────────────────────┴──────────────────────┤
│  Last updated: 2026-07-06                   │
└─────────────────────────────────────────────┘
```

**Dimensions**: 40mm × variable height (scaled to panel size)  
**Font**: Monospace 7pt for circuit numbers, Sans-serif 8pt for names  
**Density**: 203 DPI (standard Phomemo resolution)  
**Max width**: 40mm labels = 320px at 203 DPI

### 1.2 Circuit/Outlet Label

Small labels for inside electrical boxes.

```
┌───────────────────────────┐
│ Ckt 7 • Main Panel • 20A │
│ Kitchen Counter GFCI      │
└───────────────────────────┘
```

**Dimensions**: 40mm × 15mm (or 12mm tape height)  
**Use case**: Stick inside outlet/switch box cover

### 1.3 Device/Networking Label

For patch panels, switches, rack equipment.

```
┌────────────────────────────────┐
│ Port 12 │ Office AP │ VLAN 20  │
│ PoE+ 30W │ UniFi U6-Pro       │
└────────────────────────────────┘
```

**Dimensions**: 40mm × 12mm  

### 1.4 QR Code + Text Combo

Links back to the circuit detail in the PWA.

```
┌────────────────────────────────┐
│ ┌─────┐  Ckt 7 • Main Panel   │
│ │ QR  │  Kitchen Counter       │
│ │     │  20A GFCI              │
│ └─────┘                        │
└────────────────────────────────┘
```

---

## 2. Technical Architecture

### 2.1 Bluetooth Connection (Primary Path)

```
┌──────────┐     Web Bluetooth API      ┌──────────────┐
│  PWA     │ ──── BLE GATT ──────────── │  Phomemo     │
│ (Chrome) │     Service: 0xFFE0        │  M110/M120   │
│          │     Char:    0xFFE1        │              │
└──────────┘                            └──────────────┘
```

**Protocol details:**
- **Service UUID**: `0000FFE0-0000-1000-8000-00805F9B34FB`
- **Write Characteristic**: `0000FFE1-0000-1000-8000-00805F9B34FB`
- **Data format**: ESC/POS commands + raster bitmap data
- **MTU**: ~20 bytes default, negotiate up to 512 for image transfer
- **Chunking**: Send image data in 20-byte (or negotiated MTU) chunks

**Connection flow:**
1. User clicks "Connect Printer" → `navigator.bluetooth.requestDevice()`
2. Filter by name prefix "M110", "M120", "Phomemo", or "T02"
3. Connect to GATT server
4. Discover primary service (0xFFE0)
5. Get write characteristic (0xFFE1)
6. Store device reference for session (auto-reconnect on disconnect)

### 2.2 PDF Fallback (Universal Path)

For browsers without Web Bluetooth (Safari, Firefox, mobile):

```
┌──────────┐     Canvas/SVG → PDF      ┌──────────────┐
│  PWA     │ ──── Download/Print ────── │  Any Printer │
│ (any     │     via jsPDF or           │  (inkjet,    │
│  browser)│     browser print()        │   thermal)   │
└──────────┘                            └──────────────┘
```

- Generate labels as SVG/Canvas
- Convert to PDF with correct label sheet layout
- Support common label sheet sizes (Avery templates)
- Or: single-label PDF for cut-and-apply

### 2.3 Label Rendering Pipeline

```
Data (NocoDB) → Template Selection → Canvas Render → Bitmap (1-bit) → ESC/POS → BLE Write
                                   ↘ SVG Render → PDF Export (fallback)
```

---

## 3. ESC/POS Protocol Implementation

### 3.1 Command Reference

| Command | Hex | Description |
|---------|-----|-------------|
| Initialize | `1B 40` | Reset printer |
| Set density | `1D 7C nn` | Print density (1-8) |
| Raster image | `1D 76 30 m xL xH yL yH [data]` | Print bitmap |
| Feed | `1B 4A nn` | Feed n dots |
| Cut (if supported) | `1D 56 01` | Partial cut |

### 3.2 Raster Image Format

```javascript
// Image width must match printer's dot width
// Phomemo M110: 384 dots wide (48 bytes per line)
// Phomemo M120: 576 dots wide (72 bytes per line)

function imageToRaster(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const bytesPerLine = Math.ceil(width / 8);
  const raster = new Uint8Array(bytesPerLine * height);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const gray = imageData.data[i] * 0.299 
                 + imageData.data[i+1] * 0.587 
                 + imageData.data[i+2] * 0.114;
      if (gray < 128) {
        raster[y * bytesPerLine + (x >> 3)] |= (0x80 >> (x % 8));
      }
    }
  }
  return { raster, bytesPerLine, height };
}
```

### 3.3 Data Chunking for BLE

BLE characteristics have a max write size (typically 20 bytes without MTU negotiation). Large bitmaps must be chunked:

```javascript
async function sendChunked(characteristic, data, chunkSize = 100) {
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.slice(offset, offset + chunkSize);
    await characteristic.writeValueWithoutResponse(chunk);
    // Small delay to avoid overwhelming the printer buffer
    await new Promise(r => setTimeout(r, 20));
  }
}
```

---

## 4. Browser Compatibility

| Browser | Web Bluetooth | PDF Fallback | Notes |
|---------|:---:|:---:|-------|
| Chrome (desktop) | ✅ | ✅ | Full support |
| Edge (desktop) | ✅ | ✅ | Full support |
| Chrome (Android) | ✅ | ✅ | Works well |
| Safari (macOS) | ❌ | ✅ | No Web Bluetooth |
| Safari (iOS) | ❌ | ✅ | No Web Bluetooth |
| Firefox | ❌ | ✅ | No Web Bluetooth |

**Strategy**: Feature-detect `navigator.bluetooth`, show BLE option when available, always offer PDF/image download.

---

## 5. UI Flow

### 5.1 Printer Settings (one-time setup)

```
Settings → Printer Configuration
├── [Connect Printer] button
│   └── Bluetooth device picker (browser native)
├── Printer status: "Connected: Phomemo-M110"
├── Label width: [40mm ▼]
├── Print density: [Medium ▼]
└── [Print Test Label]
```

### 5.2 Panel View — Print Labels

```
Panel View → Main Panel
├── [...] menu → "Print Panel Directory"
│   └── Opens label preview modal
│       ├── Preview (scaled rendering)
│       ├── [Print via Bluetooth]
│       └── [Download PDF]
├── Individual circuit → "Print Label"
│   └── Small label preview
└── "Print All Circuit Labels"
    └── Batch progress: "Printing 12/24..."
```

### 5.3 Label Preview Modal

- Full-size preview of the rendered label
- Zoom/pan for panel directory (large label)
- Toggle: include QR code, include amps, include breaker type
- Print button (BLE or PDF based on capability)

---

## 6. Implementation Plan

### Phase 1: Label Rendering Engine
- Canvas-based label renderer
- Panel directory template
- Circuit label template
- Preview component

### Phase 2: PDF Export (Universal Fallback)
- Generate single-label or multi-label PDF
- Correct sizing for physical print
- Download trigger

### Phase 3: Bluetooth Printing
- Web Bluetooth connection service
- ESC/POS command builder
- Raster image conversion
- Chunked transmission
- Printer status/error handling

### Phase 4: UI Integration
- Print buttons on panel view
- Batch printing flow
- Settings page for printer config
- QR code generation (optional)

---

## 7. File Structure

```
src/lib/
├── components/
│   ├── LabelPreview.svelte        # Label preview modal
│   ├── LabelRenderer.svelte       # Canvas/SVG label renderer
│   └── PrinterSettings.svelte     # Printer config UI
├── services/
│   ├── bluetooth-printer.ts       # Web Bluetooth connection & protocol
│   ├── label-renderer.ts          # Canvas rendering logic
│   ├── label-templates.ts         # Template definitions
│   ├── escpos.ts                  # ESC/POS command builder
│   └── pdf-export.ts              # PDF label generation
└── types/
    └── labels.ts                  # TypeScript interfaces
```

---

## 8. Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `qrcode` | QR code generation | ~30KB |
| `jspdf` | PDF export fallback | ~280KB |
| None (Canvas API) | Label rendering | Built-in |
| None (Web Bluetooth) | Printer connection | Built-in |

Keep dependencies minimal — Canvas API and Web Bluetooth are browser-native.

---

## 9. Data Model Integration

Labels pull from existing NocoDB tables:

```typescript
interface PanelLabelData {
  panelName: string;
  amperage: number;
  circuits: {
    slot: number;
    name: string;
    amps: number;
    breakerType: 'standard' | 'gfci' | 'afci' | 'dual';
    poles: 1 | 2;
  }[];
}

interface CircuitLabelData {
  circuitNumber: number;
  panelName: string;
  name: string;
  amps: number;
  breakerType: string;
  room?: string;
}

interface DeviceLabelData {
  name: string;
  port?: number;
  vlan?: string;
  poeStatus?: string;
  connectedDevice?: string;
}
```

---

## 10. Error Handling

| Scenario | Handling |
|----------|----------|
| Bluetooth not supported | Hide BLE button, show PDF only |
| Printer not found | Retry prompt, check printer is on |
| Connection lost mid-print | Auto-reconnect, resume from last chunk |
| Image too wide | Auto-scale to printer width |
| Paper out | Display printer status notification |
| MTU too small | Fall back to 20-byte chunks |

---

## 11. Future Enhancements

### 11.1 Auto-Reconnect (replaces NFC tap-to-print)

The D30 is Bluetooth-only (no NFC). Instead, use Web Bluetooth's `watchAdvertisements()` to auto-reconnect to the last paired device without user interaction on subsequent visits.

---

### 11.2 Template Editor — Slot-Based Label Designer

**Goal:** Let users customize what appears on circuit/device labels without needing a free-form drag editor.

**Approach: Pre-designed slot layouts (not free-form)**

Rather than a blank canvas, offer **preset layouts** with named slots that users fill with field mappings. Easier to build, harder to break, still flexible.

#### Preset Layouts (ship with 4-6)

| Layout | Slots | Best for |
|--------|-------|----------|
| **Compact 1-line** (40×12mm) | `[Number]` `[Name]` `[Badge]` | Quick circuit ID on breaker |
| **Detailed 2-line** (40×20mm) | Line 1: `[Number]` `[Name]` / Line 2: `[Amps]` `[Area]` `[Badge]` | Circuit label with context |
| **Device sticker** (40×12mm) | `[DeviceName]` `[Circuit#]` `[RoomName]` | Receptacle/switch/fixture |
| **QR + Info** (40×30mm) | QR code from `[URL/ID]`, text: `[Name]` `[Detail]` | Asset tagging |
| **Wire tag** (12×40mm, rotated) | `[Circuit#]` `[Color]` `[Destination]` | Wire identification at J-box |
| **Panel slot** (40×15mm) | `[SlotNumber]` `[CircuitName]` `[Amps]` `[Protection]` | Individual breaker face |

#### Slot Configuration

Each slot maps to a data field:

```
Slot: [Name]
  → Field: Circuit.Name | Circuit.Area | Device.DisplayName | Custom text
  → Style: bold | normal | small
  → Prefix/Suffix: optional static text (e.g., "Ckt " prefix)
```

#### User Flow

1. **Settings → Label Templates** — list of saved templates
2. **"New Template"** — pick a preset layout as starting point
3. **Configure slots** — for each slot, pick the data field from a dropdown:
   - Circuit fields: Number, Name, Amps, Area, GFCI, AFCI, Poles, Notes, Panel Slot
   - Device fields: Name, Type, Room, Circuit Number, Wattage
   - Custom: free text (e.g., your name, date, house address)
4. **Preview** — live render with sample data
5. **Save** — named template, appears in print actions dropdown
6. **Use** — when printing, pick which saved template to apply

#### Persistence

- Saved in `data/label-templates.json` (same pattern as other config)
- Each template: `{ id, name, layout, slots: { slotName: { field, style, prefix, suffix } } }`
- Ship with built-in defaults that user can duplicate + customize

---

### 11.3 Label History — REMOVED

Rationale: With saved templates, reprinting is trivial (select template + select circuit → print). Tracking "was this printed before" adds DB complexity with little value. If needed later, could add a `lastPrinted` timestamp on circuit records.

---

### 11.4 Bulk Export — CSV → Label Sheet

**Goal:** Export all circuit/device data formatted for desktop label software (Avery, DYMO Label, Niimbot) or manual spreadsheet printing.

#### Export Formats

| Format | Target | Description |
|--------|--------|-------------|
| **Avery CSV** | Avery Design & Print | One row per label, columns match Avery mail-merge fields |
| **DYMO XML** | DYMO Label Software | XML format for DYMO LabelWriter printers |
| **Generic CSV** | Any spreadsheet/label app | Clean columns, user maps to their label software |

#### Data Scope Options

- **All circuits in one panel** — most common
- **All circuits across all panels** — whole-house labeling session
- **All devices** (receptacles, loads, fixtures) — for outlet/switch stickers
- **Custom filter** — by area, by type, by panel

#### CSV Columns (Generic)

```csv
Panel,Circuit#,Name,Amps,Poles,Area,GFCI,AFCI,Notes
Main Panel,1,Counter Plugs,20,1,Kitchen,No,No,
Main Panel,2,Basement Subpanel,100,2,,No,No,Feeds basement
...
```

#### User Flow

1. **Labels panel → "Export for Label Sheets"** button
2. Pick scope (this panel / all panels / devices)
3. Pick format (Generic CSV / Avery / DYMO)
4. Pick template (which fields, what order — reuses template system from 11.2)
5. Download file

---

### 11.5 Wire Labels — Color-Coded Conductor Tags

**What this is:** Small labels for individual wires at junction boxes, panel terminations, or anywhere conductors are spliced/landed. NOT panel stickers — these go on the actual wires.

#### Use Case

When you open a junction box with 4 NM cables, you see 12+ conductors (4 black, 4 white, 4 ground). Which black wire is "Kitchen Counter Plugs" vs "Dishwasher"? You'd wrap a small label around each conductor (or use flag-style wrap labels).

#### Label Content

```
┌─────────────────────────────┐
│ Ckt 1 · Kitchen Counter     │
│ BLK → Panel Slot 1          │
└─────────────────────────────┘
```

Or with wire color indicator:
```
┌─────────────────────────────┐
│ ■ BLK  Ckt 1 Counter Plugs  │
│ ■ WHT  Ckt 1 Neutral        │
│ ■ GRN  Ckt 1 Ground         │
└─────────────────────────────┘
```

#### Data Source

Would need a "Wire Runs" table in NocoDB (or derive from circuit + junction data):
- Circuit → which cables → which junction boxes → conductor colors
- The cross-floor wiring design doc already envisions this data model

#### Label Sizing

Wire labels are typically very small:
- **Flag wrap:** 12×30mm (wraps around wire, text on flag)
- **Inline tag:** 6×25mm (cable tie-on style)
- The D30 with 12mm tape is actually perfect for this

#### Priority

This is a **Phase 3+** feature — requires the wire/cable run data model to exist first. Currently we track circuits and devices but not individual conductor paths. Most useful during new construction or major rewiring.

