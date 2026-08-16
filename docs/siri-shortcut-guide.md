# Siri Shortcut Integration Guide

## Overview

The Electrical Config app exposes a `/api/ask` endpoint that accepts natural-language questions about your home's electrical configuration. You can wire this up as a Siri Shortcut for voice-driven queries like:

> "Hey Siri, ask about my electrical — What circuit is the kitchen fridge on?"

---

## Prerequisites

1. **App running** on a reachable URL (e.g., `http://192.0.2.50:5173` or a deployed instance)
2. **Open-WebUI configured** in Settings → AI Configuration
3. **API key** (copy from Settings → Shortcut API Key) — or disable "Require API Key" for trusted-network use

---

## Creating the Shortcut

### Step 1: Open Shortcuts App

On your iPhone/iPad, open the **Shortcuts** app and tap **+** to create a new shortcut.

### Step 2: Add "Ask for Input" Action

1. Search for **"Ask for Input"**
2. Set the prompt to: `What would you like to know about your electrical system?`
3. Set Input Type to **Text**

### Step 3: Add "Get Contents of URL" Action

1. Search for **"Get Contents of URL"**
2. Configure:
   - **URL:** `http://<YOUR_SERVER_IP>:5173/api/ask`
   - **Method:** `POST`
   - **Headers:**
     - `Content-Type`: `application/json`
     - `x-api-key`: `<your shortcut API key from Settings>` _(skip if auth disabled)_
   - **Request Body:** JSON
     - Key: `question`, Value: **Provided Input** (from Step 2)

### Step 4: Add "Get Dictionary Value" Action

1. Search for **"Get Dictionary Value"**
2. Get value for key: `answer`
3. Input: **Contents of URL** (from Step 3)

### Step 5: Add "Speak Text" Action

1. Search for **"Speak Text"**
2. Input: **Dictionary Value** (from Step 4)

### Step 6: (Optional) Add "Show Result"

If you also want to see the text on screen:
1. Add **"Show Result"** after Speak Text
2. Input: **Dictionary Value**

### Step 7: Name and Configure

1. Tap the shortcut name at top → rename to something like **"Ask Electrical"**
2. Tap the **ⓘ** icon → enable **"Show in Share Sheet"** if desired
3. Optionally add to Home Screen

---

## Siri Voice Trigger

Once saved, say:

> "Hey Siri, Ask Electrical"

Siri will prompt you for a question, send it to your server, and speak the answer back.

---

## Alternative: Direct Voice (No Prompt)

For a more seamless experience without the text prompt:

1. Replace "Ask for Input" with **"Dictate Text"** action
2. This uses the microphone directly — Siri records your question as speech-to-text
3. The rest of the flow is identical

---

## API Reference

### `POST /api/ask`

**Headers:**
| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |
| `x-api-key` | Conditional | Your shortcut API key (skip if auth disabled) |
| `Authorization` | Conditional | Alternative: `Bearer <key>` |

**Body:**
```json
{
  "question": "What circuit is the garage door on?"
}
```

**Response:**
```json
{
  "answer": "The garage door opener is on Circuit 14 (Panel A, 20A breaker).",
  "sources": ["NocoDB electrical data"],
  "model": "gpt-4o",
  "duration_ms": 2340
}
```

**Error responses:**
- `401` — Unauthorized (auth enabled but key missing/wrong)
- `400` — Missing `question` field
- `500` — AI processing error

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Unauthorized" error | Check your API key matches Settings → Shortcut API Key, or disable auth |
| Timeout / no response | Ensure server is reachable from phone's network |
| "Failed to process question" | Check Open-WebUI is running and configured in Settings |
| Siri says "I can't do that" | Make sure shortcut name doesn't conflict with built-in Siri commands |

---

## Security Notes

- **Trusted network only:** If you disable auth, anyone on your network can query the endpoint
- **API key rotation:** Use "Regenerate shortcut key" in Settings if compromised — update your Shortcut's header afterward
- **HTTPS recommended:** For remote access, put the app behind a reverse proxy with TLS
