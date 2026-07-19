## Execution Plan

### Phase 1 — Foundation & Architecture (do first, unblocks everything)

| #   | Issue                                     | Rationale                                        |      |
| --- | ----------------------------------------- | ------------------------------------------------ | ---- |
| 91  | MCP Architecture Redesign                 | AI/chat issues depend on this                    | done |
| 116 | DataProvider interface + SQLite migration | Enables self-contained app, used by MCP tools    |      |
| 93  | HA WebSocket real-time                    | Prerequisite for HA Phase 3c and energy features | done |
| 65  | Review unified sources                    | Tech debt cleanup before building on top         | done |

### Phase 2 — Core Feature Streams (parallel tracks, enabled by Phase 1)

| #   | Issue                               | Track              |      |
| --- | ----------------------------------- | ------------------ | ---- |
| 90  | AI Chat: cross-feature query tools  | AI (needs #91)     | done |
| 89  | AI Chat: deep link rendering        | AI (needs #90)     | done |
| 118 | AI Chat: semantic search            | AI (needs #91)     | done |
| 95  | Energy: historical range support    | Energy (quick win) | done |
| 96  | Energy: summary card + daily totals | Energy             | done |
| 97  | Energy: animated flow diagram       | Energy             | done |
| 94  | HA Phase 3c: bidirectional sync     | HA (needs #93)     | wip  |
| 102 | UniFi: scheduled sync               | UniFi              |      |
| 110 | Multi-Home Phase 1                  | Multi-Home         | done |

### Phase 3 — Feature Expansion (builds on Phase 2 outputs)

| #   | Issue                              | Track                   |      |
| --- | ---------------------------------- | ----------------------- | ---- |
| 98  | Energy: live breaker telemetry     | Energy                  |      |
| 99  | Energy: smart device control       | Energy + HA             |      |
| 100 | Energy: smart insights + analytics | Energy                  |      |
| 101 | EV Integration (Phase C)           | Energy                  |      |
| 103 | UniFi: POE budget visualization    | UniFi                   |      |
| 104 | UniFi: device status indicators    | UniFi                   |      |
| 111 | Multi-Home Phase 2–3               | Multi-Home (needs #110) | done |
| 112 | Device Unification Phase 1–2       | Devices                 |      |

### Phase 4 — Advanced Features & UX Polish

| #   | Issue                               | Track                |      |
| --- | ----------------------------------- | -------------------- | ---- |
| 113 | Device Unification Phase 3          | Devices (needs #112) |      |
| 114 | Device Unification Phase 4–5        | Devices (needs #113) |      |
| 106 | Label Printing: QR combo labels     | Labels               | wip  |
| 107 | Label Printing: physical validation | Labels               | wip  |
| 108 | Label Printing: template editor     | Labels               |      |
| 109 | Label Printing: bulk CSV/DYMO       | Labels               |      |
| 92  | Voice input for AI chat             | AI (nice-to-have)    | done |
| 67  | Plan mode: single room view         | UX                   |      |
| 88  | Other power sources & devices       | Energy               |      |

### Phase 5 — Distribution & Onboarding (after features stabilize)

|#|Issue|Rationale|
|---|---|---|
|117|Self-contained SQLite app|Needs #116 complete|
|115|Setup wizard|Needs #117 complete|
|105|AR Phase 2: QR triggers|Depends on label/QR work|

---

**Key dependency chains:**

- `#91 → #90 → #89` (MCP → AI tools → deep links)
- `#116 → #117 → #115` (DataProvider → SQLite app → setup wizard)
- `#93 → #94 → #99` (HA WebSocket → sync → device control)
- `#110 → #111` (Multi-Home phases)
- `#112 → #113 → #114` (Device Unification phases)

**Recommended parallel lanes in Phase 2:** AI, Energy, UniFi, and Multi-Home can all progress simultaneously since they touch different parts of the codebase.