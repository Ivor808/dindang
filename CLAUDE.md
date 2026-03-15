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
- **Preview proxy** (`src/server/preview-proxy.ts`): Reverse proxy to container dev servers

## Commands

```bash
npm run dev          # Start dev server on port 3000
npm run build        # Production build
npm test             # Run vitest
npm run test:watch   # Watch mode
```

## Environment

Copy `.env.example` to `.env`. Requires Supabase (local via `supabase start` or hosted) and Docker.

## Project structure

```
src/
  components/       # React components (agent-card, status-badge, machine-card)
  db/               # Drizzle schema and lazy db/supabase singletons
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
- Error handling uses `toErrorMessage()` from `src/lib/errors.ts`
- Agent names are randomly generated (`src/lib/names.ts`)
- Shell escaping uses `shellEscape()` from `src/server/transports/ssh.ts`
- Env var keys are validated with `validateEnvKey()` from `src/server/transports/ssh.ts`
