# Runtime Adapter & Orchestration Design

**Goal:** Enable dindang to launch Claude Code agents inside containers with automatic setup (auth, project clone, hooks), backed by a capacity-aware orchestrator that distributes agents across user-provided machines.

**Architecture:** Three-layer system — dindang server (web app + orchestrator), machine agents (thin HTTP daemons on VMs), and containers (Claude Code agents). For v1, all layers run as one process on localhost.

**First runtime:** Claude Code via `ANTHROPIC_API_KEY` + `claude -p`. Codex CLI planned as second runtime.

---

## Architecture Overview

```
┌──────────────────────────────────┐
│  Dindang Server (web app)        │
│  - Dashboard UI + Settings page  │
│  - Orchestrator (placement,      │
│    capacity, scaling decisions)  │
│  - Project & credential store    │
└──────────┬───────────────────────┘
           │ HTTP (authenticated)
           │
┌──────────▼───────────────────────┐
│  Machine Agent (per VM)          │
│  - Thin HTTP server              │
│  - Container lifecycle           │
│  - Resource reporting            │
│  (localhost = implicit for POC)  │
└──────────┬───────────────────────┘
           │ Docker API
           │
┌──────────▼───────────────────────┐
│  Containers (Claude Code agents) │
│  - Claude Code installed         │
│  - Project cloned + setup run    │
│  - Hooks phoning home to dindang │
│  - Persistent until explicit     │
│    teardown                      │
└──────────────────────────────────┘
```

For v1 (POC): All three layers run as one process. Dindang talks to Docker directly on localhost. No separate machine agent binary.

For production: Machine agent is deployed on remote VMs via a one-liner install script (`curl -fsSL https://dindang.dev/install.sh | bash`). Dindang server talks to them over authenticated HTTP.

---

## Settings Page

Three sections:

### Credentials
- Anthropic API key (stored encrypted, injected into containers as `ANTHROPIC_API_KEY`)
- GitHub personal access token (for cloning private repos)

### Projects
- Name (e.g., "backend-api")
- Repo URL (e.g., `github.com/org/backend-api`)
- Setup command (optional, e.g., `npm install && npm run db:migrate`)
- One project can be marked as default (used when creating agents without selecting)

### Machines
- Implicit "localhost" always present for local Docker (not removable)
- Add remote machines: name, host, auth token
- Max agents per machine (auto-calculated recommendation based on reported CPU/RAM, user can override)
- Status indicator (connected/disconnected, current agent count)

**For v1:** Only Credentials and Projects sections. Machines section shows localhost only and is read-only.

**Storage:** JSON file at `~/.dindang/config.json`. API keys encrypted with a machine-specific key. Future: database.

---

## Agent Creation & Lifecycle

### Creation flow
1. User clicks "+ new" on dashboard
2. Dropdown shows projects from settings (default pre-selected)
3. Optional: count field — "how many agents?" (default: 1)
4. Click "create"
5. Orchestrator picks machine(s) with capacity
6. Container created → repo cloned → setup command runs → Claude Code installed + configured
7. Agent card appears on dashboard, status progresses: `provisioning` → `ready`

### Agent statuses
- `provisioning` — container being created, repo cloning, setup running
- `ready` — setup complete, waiting for user interaction
- `busy` — Claude Code is actively working on a task
- `error` — setup failed or container crashed

### Reusability
- Containers persist by default. No auto-teardown.
- "Remove" is explicit and destructive (confirms before deleting).
- Idle VMs flagged in UI but user decides to keep or destroy.

### Batch creation
- "I want 15 agents on backend-api" → orchestrator distributes across machines based on capacity.
- If not enough capacity: creates what it can, surfaces "Created 10/15 — add more machines for remaining 5."

**For v1:** Single agent creation only. Always placed on localhost. No capacity checks.

---

## Claude Code Runtime Adapter

### Container setup sequence
1. Base image: `node:22-slim` (Claude Code needs Node.js)
2. Install common dev tools: `git`, `curl`, `build-essential`
3. Install Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`
4. Clone project repo using GitHub token
5. Run setup command if defined (e.g., `npm install`)
6. Write `.claude/settings.json` with HTTP hooks pointing back to dindang
7. Container is `ready`

### Hooks configuration (injected automatically)
```json
{
  "hooks": {
    "PostToolUse": [{
      "hooks": [{
        "type": "http",
        "url": "http://<dindang-host>/api/hooks/agent/<agent-name>",
        "headers": { "Authorization": "Bearer <agent-token>" }
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "http",
        "url": "http://<dindang-host>/api/hooks/agent/<agent-name>",
        "headers": { "Authorization": "Bearer <agent-token>" }
      }]
    }]
  }
}
```

### What hooks give us
- Activity tracking — dindang knows when an agent is working vs idle
- Status updates — when Claude Code finishes a task, dindang moves status to `ready`
- Audit log — record of what each agent did (future feature)

### User interaction
- For v1: Terminal UI sends commands via `docker exec claude -p "<prompt>"`
- Future: WebSocket + xterm.js for real-time interactive terminal

**For v1:** Pre-built Docker image with Node.js + Claude Code baked in (avoids install time on every create). Hooks point to localhost. Terminal uses current polling approach.

---

## Orchestrator & Capacity Model

### Placement logic
1. Get list of machines sorted by current utilization (least loaded first)
2. Filter to machines with available capacity (`current agents < max agents`)
3. Place agent on the least loaded machine
4. If no capacity, return error with guidance ("add more machines")

### Capacity calculation
Auto-recommended threshold per machine:
- Base formula: `floor(available_ram_gb / 2)` — each Claude Code agent uses ~1-2GB RAM
- Capped by CPU: `max(1, cores - 1)` — leave one core for OS + machine agent
- Final recommendation: `min(ram_based, cpu_based)`
- User can override in settings

### Idle machine detection (future)
- Machines with zero agents for longer than a configurable TTL get flagged
- Dindang surfaces "machine X has been idle for 2h" in the UI
- User decides to keep or tear down — dindang doesn't auto-destroy infrastructure it didn't create

**For v1:** No orchestrator logic. Single implicit localhost machine. No capacity checks. Data model and interfaces designed but not implemented.

---

## Data Model

```
Settings
├── anthropicApiKey: string (encrypted)
├── githubToken: string (encrypted)
└── encryptionSalt: string

Project
├── id: string
├── name: string
├── repoUrl: string
├── setupCommand?: string
├── isDefault: boolean

Machine
├── id: string
├── name: string
├── host: string (localhost for v1)
├── authToken: string
├── maxAgents: number
├── autoMaxAgents: number (calculated recommendation)
├── status: "connected" | "disconnected"

Agent
├── id: string
├── name: string
├── projectId: string
├── machineId: string
├── containerId: string
├── status: "provisioning" | "ready" | "busy" | "error"
├── createdAt: string
```

### Changes from current codebase
- `Agent` type gets `projectId` and `machineId` fields
- New `Project` and `Machine` types
- New settings store (currently no persistence)
- `DeploymentProvider` interface stays but is used by machine agent layer
- New server functions for settings CRUD and project CRUD
- New `/settings` route for the settings page
- Agent creation flow updated with project dropdown

### What stays the same
- TanStack Start framework, server functions pattern
- Dashboard grid layout
- Terminal UI on agent detail page (polling-based for v1)
- Dark theme, monospace, minimal styling
