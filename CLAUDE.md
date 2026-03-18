# dindang

Web platform for spawning and managing AI coding agents (Claude Code, Codex CLI) on remote machines. Users configure projects and machines, then spin up containerized agents that clone repos, install tools, and present a live terminal in the browser.

## Stack

- **Frontend**: React 19 + TanStack Router/Start (SPA mode) + Tailwind CSS 4 + xterm.js
- **Backend**: Vite dev server with `createServerFn` (TanStack Start) — no separate API server
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: Supabase Auth (OAuth + email/password)
- **Containers**: dockerode (local Docker), SSH (remote Docker + direct terminal)

## Key architecture

- **Transport** (`src/lib/transport.ts`): Abstraction over exec, PTY, file I/O — implemented by DockerTransport, ServerTransport, SSHTransport
- **AgentRuntime** (`src/lib/transport.ts`): Container lifecycle (create/stop/remove) — implemented by DockerAgentRuntime, ServerAgentRuntime, SSHAgentRuntime
- **Machine types**: `local` (Docker on host), `server` (Docker over SSH), `terminal` (direct SSH)
- **Agent setup** (`src/server/agent-setup.ts`): Creates `dev` user, installs AI CLI, clones repo, runs setup command — all via Transport
- **Terminal**: WebSocket bridge (`src/server/terminal.ts`) connecting browser xterm to container PTY
- **Preview proxy** (`src/server/preview-proxy.ts`): Reverse proxy to container dev servers with path rewriting
- **Agent hooks** (`src/server/agent-hooks.ts`): HTTP endpoint that receives Claude Code hook callbacks to track busy/idle status
- **Update banner** (`src/components/update-banner.tsx`): Checks GitHub API for newer commits, shows update notification
- **Confirm modal** (`src/components/confirm-modal.tsx`): Reusable confirmation dialog (used for dirty state warnings)

## Commands

```bash
npm run dev          # Start dev server on port 3000 (with HMR)
npm run build        # Production build (client + server)
npm start            # Run production server
npm test             # Run vitest
npm run test:watch   # Watch mode
```

## Environment

Copy `.env.example` to `.env`. Requires Docker. In local mode (default), only `DATABASE_URL` is needed. For hosted mode, also requires Supabase.

## Production Server

`server.ts` is the production entry point — a standalone Node HTTP server that:
- Serves the TanStack Start build from `dist/` with path traversal protection
- Attaches WebSocket terminal, agent hooks, preview proxy
- Runs lifecycle handlers (seeding, reconciliation)

In dev mode, the Vite plugin (`dindangServer()` in `vite.config.ts`) handles the same wiring via `configureServer`.

## Preview proxy path rewriting

The preview proxy at `/preview/<agent-name>/` rewrites responses so apps with absolute paths work correctly:

- **HTML responses**: Rewrites `src`, `href`, `action` attributes starting with `/` to include the proxy prefix. Injects a script that intercepts link clicks, `history.pushState`/`replaceState`, and `fetch` calls to rewrite absolute paths through the proxy.
- **Redirect responses**: Rewrites `Location` headers on 3xx responses to include the proxy prefix.
- **Non-HTML responses**: Passed through unchanged.

This allows apps with routes like `/home` or `/about` to work behind the `/preview/<agent>/` path without the app needing any configuration. The rewriting handles most static sites and SPAs but may not cover all edge cases (e.g., WebSocket upgrades, CSS `url()` references, hardcoded paths in JS bundles).

## Agent container setup

Agent containers (`node:22-slim`) are created by `DockerAgentRuntime` with:
- A named volume (`dindang-<name>:/home`) that persists across redeploys
- `ExtraHosts: host.docker.internal:host-gateway` for callback connectivity
- Docker socket mounted for infrastructure isolation (`COMPOSE_PROJECT_NAME`)

During setup (`src/server/agent-setup.ts`):
- System packages installed (git, curl, tmux, socat, etc.)
- `dev` user created with passwordless sudo
- AI CLI installed (Claude Code or Codex)
- For Claude Code: socat forwards `127.0.0.1:3000` → `host.docker.internal:3000` so hooks pass Claude's localhost-only security check
- tmux configured with alternate screen disabled (for xterm.js scrollback)
- Repo cloned, setup command run

## Lifecycle

- **Startup**: Seeds local user/org (local mode), reconciles error-state agents (stops their containers)
- **Shutdown**: Exits cleanly without stopping agent containers — they survive dindang restarts/updates
- **Redeploy**: Destroys container but preserves the `/home` volume (code, git history, Claude auth persist)

## Project structure

```
src/
  components/       # React components (agent-card, status-badge, machine-card)
  db/               # Drizzle schema and lazy db singleton
  lib/              # Shared types, transport interfaces, utilities
  routes/           # TanStack Router pages (dashboard, agent detail, settings, login)
  server/           # Server functions, runtimes, transports, terminal WS, auth
    runtimes/       # AgentRuntime implementations (docker, server, ssh)
    transports/     # Transport implementations (docker, server, ssh)
supabase/           # Supabase local dev config
```

## Conventions

- Server functions use `createServerFn` from TanStack Start — called directly from components
- All agent containers run as non-root `dev` user with passwordless sudo
- Credentials are encrypted at rest with per-user derived keys (`src/lib/crypto.ts`)
- Error handling uses `toErrorMessage()` from `src/lib/errors.ts` — strips null bytes and control chars for PostgreSQL safety
- Agent names are randomly generated (`src/lib/names.ts`)
- Shell escaping uses `shellEscape()` from `src/server/transports/ssh.ts` — used in terminal.ts, server transport, and anywhere user input enters shell commands
- Env var keys are validated with `validateEnvKey()` from `src/server/transports/ssh.ts`
- WebSocket session names are validated with `/^[a-zA-Z0-9_-]+$/` before use
- Docker exec output is demuxed (`modem.demuxStream`) to properly separate stdout/stderr
- Status badge displays "idle" for the `ready` DB status
- The `checkDirtyState` server function runs `git status` inside containers before destructive actions (remove/redeploy)
- Build embeds git SHA via `VITE_DINDANG_VERSION` for update detection
