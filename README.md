# Ω Ohm

**AI-powered home electrical intelligence.**

Know your home, circuit by circuit. Ohm gives you instant answers about your electrical system — which circuit powers the kitchen island, what's drawing 800W right now, and whether your solar is covering it.

## What it does

- **Circuit topology** — Browse panels, circuits, rooms, outlets, and loads
- **Energy monitoring** — Live power consumption and solar production via Home Assistant
- **AI assistant** — Natural language queries: "Ask Ohm which circuit the kitchen is on"
- **Multi-home support** — Manage multiple properties from one interface
- **Device discovery** — Auto-detect UniFi network devices per home

## Stack

- **SvelteKit** — Full-stack framework (SSR + SPA)
- **Tailwind CSS** — Dark-first, mobile-first UI
- **NocoDB** — Electrical topology data store
- **Home Assistant** — Energy sensors (Emporia Vue, Enphase Solar)
- **Vercel AI SDK v7** — Streaming AI chat with tool calling
- **Open WebUI** → Azure OpenAI — LLM provider chain

## Quick start

```bash
npm install
cp .env.example .env   # Configure your endpoints
npm run dev
```

## Brand

**Name:** Ohm (Ω) — the SI unit of resistance. Also sounds like "home."

**Personality:** Proactive, friendly, intelligent. Surfaces insights before you ask.

**Colors:** Electric Indigo (`#6366F1`) for AI/intelligence, Amber (`#F5A623`) for energy data, Cyan (`#22D3EE`) for solar/live streams.

---

Built for personal use. May open-source later.
