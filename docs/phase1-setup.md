# Phase 1: Open-WebUI + NocoDB MCP Integration

## Overview

Connect NocoDB's MCP server to Open-WebUI via **MCPO** (MCP-to-OpenAPI proxy), enabling any model to query your electrical configuration data through natural language.

**Time:** ~30 minutes  
**Prerequisites:** Open-WebUI v0.10+, NocoDB with MCP enabled, Docker

---

## Architecture

```
┌─────────────────────┐
│   Open-WebUI        │
│   (any model)       │
│                     │
│  Tool Server URL:   │
│  http://mcpo:8000/  │
│  nocodb-electrical  │
└─────────┬───────────┘
          │ OpenAPI (auto-generated)
          ▼
┌─────────────────────┐
│   MCPO Container    │
│   (MCP→OpenAPI      │
│    proxy)           │
└─────────┬───────────┘
          │ MCP Protocol (Streamable HTTP)
          ▼
┌─────────────────────┐
│   NocoDB            │
│   MCP Endpoint      │
│   /mcp/<base_id>    │
└─────────────────────┘
```

---

## Step 1: Create MCPO Config

Create a file `mcpo/config.json` alongside your Open-WebUI docker-compose:

```json
{
  "mcpServers": {
    "nocodb-electrical": {
      "type": "streamable_http",
      "url": "http://nocodb.example.com/mcp/your_nocodb_base_id",
      "headers": {
        "xc-mcp-token": "YOUR_NOCODB_MCP_TOKEN"
      }
    }
  }
}
```

> **Important:** The server name (`nocodb-electrical`) becomes the URL path prefix. Avoid spaces in the name — they cause URL encoding issues with Open-WebUI.

> **Getting your MCP token:** In NocoDB, go to your base → Integrations → MCP → copy the `xc-mcp-token` value.

---

## Step 2: Docker Compose

Add the MCPO service to your Open-WebUI compose file. **Both services must be on the same Docker network:**

```yaml
services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    container_name: open-webui
    networks:
      - traefik
    ports:
      - "3800:8080"
    volumes:
      - open-webui:/app/backend/data
    extra_hosts:
      - "host.docker.internal:host-gateway"
    restart: unless-stopped
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.open-webui.rule=Host(`open-webui.example.com`)"
      - "traefik.http.routers.open-webui.entrypoints=web"
      - "traefik.http.services.open-webui.loadbalancer.server.port=8080"
      - "traefik.docker.network=traefik"

  mcpo:
    image: ghcr.io/open-webui/mcpo:main
    container_name: open-webui-mcpo
    volumes:
      - ./mcpo:/config:ro
    command: ["--host", "0.0.0.0", "--port", "8000", "--config", "/config/config.json"]
    networks:
      - traefik
    restart: unless-stopped

networks:
  traefik:
    external: true

volumes:
  open-webui:
```

**Key points:**
- MCPO must be on the **same network** as Open-WebUI (`traefik` in this case)
- The config volume maps `./mcpo/` (where `config.json` lives) to `/config` inside the container
- No ports need to be published externally — only Open-WebUI needs to reach MCPO

Deploy:
```bash
docker compose up -d
```

---

## Step 3: Configure Tool Server in Open-WebUI

1. Go to **Admin Panel → Settings → Integrations → Manage Tool Servers**
2. Click **+ (Add)**
3. Set the URL to:
   ```
   http://open-webui-mcpo:8000/nocodb-electrical
   ```
   > This is the container name + port + server name from your config.json
4. Click the refresh/verify button — should show **"Connection successful"**
5. Save

### Troubleshooting Connection Issues

| Problem | Fix |
|---------|-----|
| "Connection failed" | Ensure MCPO is on the same Docker network as Open-WebUI |
| MCPO logs show "No MCP servers could be reached" | Check NocoDB URL is reachable from inside MCPO container |
| `Invalid port: 'PORT'` error | You have a literal `:PORT` placeholder in your config.json URL |
| Root `openapi.json` shows empty `paths: {}` | You must include the server name path prefix (`/nocodb-electrical`) in the Tool Server URL |
| Tools don't appear in chat | Refresh the page, start a **new** chat |

---

## Step 4: Use It

1. Start a **new chat** in Open-WebUI
2. Select a model (see recommendations below)
3. Click the **tools grid icon** (⊞) at the bottom of the chat input
4. Toggle **nocodb-electrical** ON
5. Ask questions naturally:
   - "List all tables in my electrical database"
   - "What circuits are in the kitchen?"
   - "Show me all GFCI breakers"
   - "What loads are on circuit 12?"

The model will automatically call NocoDB tools (you'll see "View Result from..." in the response).

---

## Model Recommendations

### Cloud Models (via Azure OpenAI or OpenAI API)

| Model | Tool Calling | Notes |
|-------|:---:|-------|
| **GPT-4o** | ⭐⭐ Excellent | Reliably calls tools, best results |
| GPT-4o-mini | ⭐ Good | Cheaper, still reliable |

### Local Models (via Ollama)

| Model | Tool Calling | Notes |
|-------|:---:|-------|
| `qwen2.5:32b` | ⭐ Great | Best local option if you have VRAM |
| `qwen2.5:14b` | Good | Solid balance of speed and reliability |
| `qwen2.5:7b` | Hit or miss | May ignore tools or hallucinate |
| `llama3.1:8b` | Poor | Rarely invokes tools correctly |

**Recommendation:** Use **GPT-4o** for reliable results, or **qwen2.5:14b+** locally.

---

## Step 5 (Optional): Create a Dedicated Model Preset

To avoid enabling the tool manually each chat:

1. Go to **Workspace → Models → + Create a Model**
2. Set:
   - **Name:** Electrical Assistant
   - **Base Model:** gpt-4o (or qwen2.5:14b)
   - **Tools:** Enable `nocodb-electrical`
   - **System Prompt:**
     ```
     You are an electrical configuration assistant for the project owner's homes. You have 
     access to a NocoDB database with electrical data (Areas, Panels, Circuits, 
     Receptacles, Loads).

     Always use the nocodb-electrical tools to look up data. Never guess.
     Be specific with circuit numbers, panel names, and breaker types.
     For update requests, confirm before executing.
     ```
3. Save — now "Electrical Assistant" appears in your model selector with tools pre-enabled

---

## Available NocoDB MCP Tools

Once connected, these tools are available (discovered automatically from NocoDB):

| Tool | Description |
|------|-------------|
| `getBaseInfo` | Fetch information about the electrical database |
| `getTablesList` | List all tables (Areas, Panels, Circuits, etc.) |
| `getTableSchema` | Get field definitions for a specific table |
| `getRecords` | Query records with filters |
| `createRecord` | Add a new record |
| `updateRecord` | Modify an existing record |
| `deleteRecord` | Remove a record |

> The exact tool list depends on your NocoDB MCP server version.

---

## What's Next

- **Phase 2:** SvelteKit PWA — mobile UX + `/api/ask` endpoint
- **Phase 3:** Siri Voice Bridge — iOS Shortcut calls the PWA API
- **Phase 4:** Home Assistant integration — iframe embed + REST sensors
- **Phase 5:** Interactive Floor Plans
