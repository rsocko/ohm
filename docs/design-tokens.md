# Design Tokens — Electrical Config PWA

> Source of truth: `app/src/app.css` → `@theme` block.
> All UI should reference these tokens via Tailwind v4 utility classes.

---

## Usage

Tailwind v4 generates utility classes from `@theme` properties by stripping the prefix:

| CSS Variable | Utility Class Examples |
|---|---|
| `--color-surface-raised` | `bg-surface-raised` |
| `--color-fg` | `text-fg` |
| `--color-accent-subtle` | `bg-accent-subtle` |
| `--color-border` | `border-border` |
| `--radius-card` | `rounded-card` |
| `--shadow-card` | `shadow-card` |
| `--font-size-page-title` | `text-page-title` |
| `--spacing-section` | `gap-section`, `p-section`, `space-y-section` |

Semantic utility shortcuts (defined via `@utility`):
- `card` — applies radius, background, border, shadow for a standard card
- `sheet` — applies bottom-sheet styling (top radius, border-top, upward shadow)

---

## Token Reference

### Surfaces

| Token | Utility | Use |
|---|---|---|
| `--color-surface-base` | `bg-surface-base` | App body background |
| `--color-surface-raised` | `bg-surface-raised` | Cards, sections, panels |
| `--color-surface-overlay` | `bg-surface-overlay` | Popovers, bottom sheets, modals |
| `--color-surface-hover` | `bg-surface-hover` | Interactive element hover |
| `--color-surface-active` | `bg-surface-active` | Selected/pressed state |

### Foreground (Text)

| Token | Utility | Use |
|---|---|---|
| `--color-fg` | `text-fg` | Primary text (headings, names, values) |
| `--color-fg-secondary` | `text-fg-secondary` | Body text, descriptions |
| `--color-fg-muted` | `text-fg-muted` | Labels, section titles, captions |
| `--color-fg-faint` | `text-fg-faint` | Disabled, placeholder, meta info |

### Borders

| Token | Utility | Use |
|---|---|---|
| `--color-border` | `border-border` | Default borders |
| `--color-border-subtle` | `border-border-subtle` | Subtle card edges |
| `--color-border-focus` | `ring-border-focus` | Focus indicators |

### Accent (Primary Interactive — Purple)

| Token | Utility | Use |
|---|---|---|
| `--color-accent` | `bg-accent`, `ring-accent` | Active states, focus rings |
| `--color-accent-subtle` | `bg-accent-subtle` | Tinted backgrounds (pills, badges) |
| `--color-accent-fg` | `text-accent-fg` | Active text on accent backgrounds |

### Info (Secondary — Blue/Sky)

| Token | Utility | Use |
|---|---|---|
| `--color-info` | `bg-info` | Informational badges |
| `--color-info-subtle` | `bg-info-subtle` | Tinted info backgrounds |
| `--color-info-fg` | `text-info-fg` | Info text |

### Status

| Token | Utility | Use |
|---|---|---|
| `--color-success` | `bg-success`, `text-success` | Online, OK, connected |
| `--color-success-subtle` | `bg-success-subtle` | Success background tint |
| `--color-warning` | `bg-warning`, `text-warning` | Warnings, caution |
| `--color-warning-subtle` | `bg-warning-subtle` | Warning background tint |
| `--color-danger` | `bg-danger`, `text-danger` | Error, offline, critical |
| `--color-danger-subtle` | `bg-danger-subtle` | Danger background tint |

### Source Indicators

| Token | Utility | Color | Use |
|---|---|---|---|
| `--color-source-nocodb` | `bg-source-nocodb` | Emerald | NocoDB (electrical data) |
| `--color-source-unifi` | `bg-source-unifi` | Blue | UniFi (network) |
| `--color-source-ha` | `bg-source-ha` | Sky/Cyan | Home Assistant |
| `--color-source-homebox` | `bg-source-homebox` | Amber | Homebox (inventory) |

### Category Colors

Used for device category icons and badges:

| Token | Category |
|---|---|
| `--color-cat-networking` | Networking (fuchsia) |
| `--color-cat-computing` | Computing (slate) |
| `--color-cat-iot` | IoT hubs (teal) |
| `--color-cat-media` | Media (purple) |
| `--color-cat-camera` | Cameras (red) |
| `--color-cat-climate` | Climate/HVAC (green) |
| `--color-cat-lighting` | Lighting (yellow) |
| `--color-cat-appliance` | Appliances (orange) |
| `--color-cat-power` | Power/electrical (amber) |

### Radii

| Token | Utility | Size | Use |
|---|---|---|---|
| `--radius-pill` | `rounded-pill` | 9999px | Pills, badges, status dots |
| `--radius-sm` | `rounded-sm` | 8px | Small elements |
| `--radius-md` | `rounded-md` | 12px | List items, inputs, buttons |
| `--radius-card` | `rounded-card` | 16px | Cards, panels |
| `--radius-panel` | `rounded-panel` | 20px | Bottom sheets, dialogs |

### Shadows

| Token | Utility | Use |
|---|---|---|
| `--shadow-card` | `shadow-card` | Elevated card (includes subtle inset highlight) |
| `--shadow-sheet` | `shadow-sheet` | Bottom sheet upward shadow |
| `--shadow-glow-online` | `shadow-glow-online` | Online indicator glow |
| `--shadow-glow-offline` | `shadow-glow-offline` | Offline indicator glow |

### Typography (Font Sizes)

| Token | Utility | Size | Use |
|---|---|---|---|
| `--font-size-page-title` | `text-page-title` | 24px | Page headings |
| `--font-size-section-title` | `text-section-title` | 14px | Section headings |
| `--font-size-body` | `text-body` | 14px | Body text, list items |
| `--font-size-caption` | `text-caption` | 12px | Meta info, labels |

### Spacing

| Token | Utility | Size | Use |
|---|---|---|---|
| `--spacing-page` | `p-page` | 16px | Page-level horizontal padding |
| `--spacing-card` | `p-card` | 20px | Card internal padding |
| `--spacing-section` | `gap-section` | 16px | Gap between sections |

---

## Patterns

### Card
```html
<div class="card p-card">...</div>
<!-- Equivalent to: rounded-card bg-surface-raised border-border-subtle shadow-card -->
```

### Bottom Sheet
```html
<div class="sheet p-card">...</div>
<!-- Equivalent to: rounded-panel (top only) bg-surface-base border-t-border-subtle shadow-sheet -->
```

### List Item (interactive)
```html
<button class="w-full flex items-center gap-3 p-3 rounded-md hover:bg-surface-hover text-left transition-colors">
  <span class="text-body text-fg">Name</span>
  <span class="text-caption text-fg-faint">Meta</span>
</button>
```

### Pill / Badge
```html
<span class="text-caption font-medium px-2.5 py-1 rounded-pill bg-accent-subtle text-accent-fg">
  Label
</span>
```

### Status Dot
```html
<span class="w-2 h-2 rounded-full bg-success shadow-glow-online"></span>
<span class="w-2 h-2 rounded-full bg-danger shadow-glow-offline"></span>
```

### Section Title
```html
<h3 class="text-caption font-semibold text-fg-muted uppercase tracking-wide">Section</h3>
```

---

## Migration Guide

When adding new UI or updating existing pages, replace hardcoded values:

| Old (hardcoded) | New (token) |
|---|---|
| `text-white` | `text-fg` |
| `text-slate-300` | `text-fg-secondary` |
| `text-slate-400` | `text-fg-muted` |
| `text-slate-500` | `text-fg-faint` |
| `bg-slate-800/50` | `bg-surface-raised` |
| `bg-slate-800/60` | `bg-surface-overlay` |
| `hover:bg-slate-800/50` | `hover:bg-surface-hover` |
| `border-slate-700/60` | `border-border` |
| `border-slate-700/40` | `border-border-subtle` |
| `bg-purple-500/20` | `bg-accent-subtle` |
| `text-purple-300` | `text-accent-fg` |
| `bg-emerald-400` | `bg-source-nocodb` |
| `bg-blue-400` | `bg-source-unifi` |
| `bg-sky-400` | `bg-source-ha` |
| `rounded-2xl` | `rounded-card` |
| `rounded-xl` | `rounded-md` |
| `text-sm` | `text-body` |
| `text-xs` | `text-caption` |

> **Note:** Existing pages don't need to be migrated immediately.
> New code MUST use tokens. Existing code should be migrated incrementally.
