# Multi-Provider Architecture Design

**Date:** 2026-03-13
**Status:** Draft (rev 3 — adds Supabase auth/DB, orgs, Drizzle ORM)

## Overview

Dindang currently manages AI coding agents exclusively via local Docker containers with a local config file. This design introduces:

1. **Provider-agnostic architecture** — register any machine (Docker, SSH, cloud VM) and manage agents on it through a unified interface
2. **Supabase auth and database** — GitHub/Google OAuth, Postgres with RLS, org/team support
3. **Proper credential management** — per-user and per-org encryption with server-side secret

The core principle: **dindang manages agents, not infrastructure.** Users bring their own machines (BYOE). Managed provisioning (spinning up cloud VMs) is a separate, optional layer designed as a future extension point.

## Goals

- Support local Docker and remote SSH machines as first-class deployment targets
- Write agent setup and terminal logic once, reusable across all transports
- GitHub and Google OAuth for user authentication
- Org/team model with Owner/Admin/Member roles
- Postgres (Supabase) as the data store with row-level security
- Per-user and per-org credential encryption
- Design for future cloud provider integration without requiring architectural changes

## Non-Goals

- Cloud VM provisioning (AWS/Azure/GCP) — future extension, not part of this spec
- Container orchestration (Kubernetes, Docker Swarm) — users manage their own orchestration
- Billing / subscription management — future concern
- Self-hosted deployment mode — future (hosted SaaS only for now)

---

## 1. Authentication

### Supabase Auth with OAuth

- **Login page** at `/login` — two buttons: "Sign in with GitHub" and "Sign in with Google"
- **GitHub OAuth** requests `repo` scope — gives dindang read/write access to the user's repos. The GitHub access token is encrypted and stored per-user, replacing the global `githubToken` in settings.
- **Google OAuth** — authentication only, no repo access. Users who sign in with Google must manually provide a GitHub token in settings if they want repo cloning.
- **Session management** — Supabase handles JWTs (stored in httpOnly cookies), refresh tokens, and session expiry.
- **Auth middleware** — TanStack Start middleware checks the Supabase session on every server function call. Unauthenticated requests redirect to `/login`. The WebSocket upgrade handler also validates the session before allowing terminal connections.

### First Login Flow

1. User signs in with GitHub or Google
2. An org is auto-created for the user with their display name (e.g. "Runa's Workspace")
3. The user becomes the Owner of that org
4. They land on the dashboard — no "create org" step required
5. If signed in with GitHub, the access token is encrypted and stored in `user_credentials`

---

## 2. Database Schema (Drizzle)

All tables use UUIDs as primary keys. Managed by Drizzle ORM with `drizzle-kit` for migrations.

### Tables

```
orgs
  id                uuid PK DEFAULT gen_random_uuid()
  name              text NOT NULL
  created_at        timestamptz DEFAULT now()

org_members
  id                uuid PK DEFAULT gen_random_uuid()
  org_id            uuid FK → orgs ON DELETE CASCADE
  user_id           uuid FK → auth.users
  role              text NOT NULL CHECK (role IN ('owner', 'admin', 'member'))
  created_at        timestamptz DEFAULT now()
  UNIQUE(org_id, user_id)

machines
  id                uuid PK DEFAULT gen_random_uuid()
  org_id            uuid FK → orgs ON DELETE CASCADE
  name              text NOT NULL
  type              text NOT NULL CHECK (type IN ('docker', 'ssh'))
  host              text
  port              int DEFAULT 22
  username          text
  auth_method       text CHECK (auth_method IN ('key', 'password'))
  encrypted_credential    text           -- AES-256-GCM ciphertext (org-derived key)
  host_key_fingerprint    text
  enabled           boolean DEFAULT true
  status            text DEFAULT 'unknown' CHECK (status IN ('connected', 'unreachable', 'unknown'))
  created_at        timestamptz DEFAULT now()

projects
  id                uuid PK DEFAULT gen_random_uuid()
  org_id            uuid FK → orgs ON DELETE CASCADE
  name              text NOT NULL
  repo_url          text NOT NULL
  setup_command     text
  dev_port          int CHECK (dev_port BETWEEN 1 AND 65535)
  is_default        boolean DEFAULT false
  created_at        timestamptz DEFAULT now()

agents
  id                uuid PK DEFAULT gen_random_uuid()
  org_id            uuid FK → orgs ON DELETE CASCADE
  project_id        uuid FK → projects
  machine_id        uuid FK → machines
  created_by        uuid FK → auth.users
  name              text NOT NULL
  remote_id         text NOT NULL       -- container ID or SSH session ID
  work_dir          text NOT NULL
  status            text DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'ready', 'busy', 'error'))
  host_port         int
  created_at        timestamptz DEFAULT now()

user_credentials
  id                uuid PK DEFAULT gen_random_uuid()
  user_id           uuid FK → auth.users ON DELETE CASCADE
  provider          text NOT NULL CHECK (provider IN ('github', 'anthropic'))
  encrypted_token   text NOT NULL       -- AES-256-GCM (user-derived key)
  created_at        timestamptz DEFAULT now()
  updated_at        timestamptz DEFAULT now()
  UNIQUE(user_id, provider)
```

### Row-Level Security

RLS policies on all org-scoped tables (`machines`, `projects`, `agents`):

```sql
-- Example for machines (same pattern for projects, agents)
CREATE POLICY machines_org_access ON machines
  USING (org_id IN (
    SELECT org_id FROM org_members WHERE user_id = auth.uid()
  ));
```

`user_credentials` is scoped to the individual user:

```sql
CREATE POLICY user_credentials_own ON user_credentials
  USING (user_id = auth.uid());
```

`org_members` allows users to see their own memberships:

```sql
CREATE POLICY org_members_own ON org_members
  USING (user_id = auth.uid());
```

### Drizzle Setup

- Schema defined in `src/db/schema.ts` using Drizzle's `pgTable` API
- Migrations via `drizzle-kit generate` / `drizzle-kit migrate`
- Connection via `postgres` (postgres.js) using `DATABASE_URL` from Supabase
- RLS policies defined as raw SQL in migration files (Drizzle doesn't manage RLS natively)
- Database client created in `src/db/index.ts`, imported by server functions

---

## 3. Role Permissions

| Action | Owner | Admin | Member |
|---|---|---|---|
| Manage org settings | Y | | |
| Invite / remove members | Y | Y | |
| Change member roles | Y | | |
| Add / edit / remove machines | Y | Y | |
| Add / edit / remove projects | Y | Y | |
| Create agents | Y | Y | Y |
| View / interact with agents | Y | Y | Y |
| Stop / remove agents | Y | Y | own only |

- **Nobody sees raw credentials** — the UI shows "configured" / "connected", never the actual key or token
- **Role enforcement** happens in server functions, not RLS — RLS handles visibility (org membership), application logic handles "can this role do this action"
- Members can stop/remove only agents where `created_by = auth.uid()`

---

## 4. Credential Encryption

### Server Secret

- `DINDANG_ENCRYPTION_SECRET` environment variable — a 32+ character random string, set on the deployment, never stored in the database
- This replaces the local `~/.dindang/.key` file entirely

### Per-User Key Derivation

For `user_credentials` (GitHub tokens, Anthropic API keys):

```
key = scrypt(DINDANG_ENCRYPTION_SECRET, userId, N=65536, r=8, p=1) → 32 bytes
```

Each user's credentials are encrypted with a unique derived key. Compromising one user's key doesn't expose other users' data.

### Per-Org Key Derivation

For `machines.encrypted_credential` (SSH keys, SSH passwords):

```
key = scrypt(DINDANG_ENCRYPTION_SECRET, orgId, N=65536, r=8, p=1) → 32 bytes
```

Machine credentials are org-scoped — any org member with sufficient role can use the machine, but the credential is only ever decrypted server-side at connection time.

### Encryption Algorithm

- AES-256-GCM with random 12-byte IV per encryption
- Random 16-byte salt per encryption for additional uniqueness
- Ciphertext stored as base64 string: `salt:iv:ciphertext:authTag`

### Rules

- Credentials are **never** logged, sent to the frontend, or included in error messages
- Decrypted credentials are **not cached** — decrypted only at the moment of use
- If `DINDANG_ENCRYPTION_SECRET` is not set, the server refuses to start

---

## 5. Transport Abstraction

A `Transport` interface handles low-level machine operations (exec, PTY, file I/O). It is intentionally narrow — it does not handle agent lifecycle.

```typescript
interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface PTYOptions {
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  cwd?: string;
}

interface PTYSession {
  stream: NodeJS.ReadWriteStream;
  resize(cols: number, rows: number): void;
  close(): void;
}

interface Transport {
  exec(cmd: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<ExecResult>;
  openPTY(options?: PTYOptions): Promise<PTYSession>;
  writeFile(path: string, content: string, mode?: number): Promise<void>;
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  destroy(): Promise<void>;
}
```

### DockerTransport

Wraps the existing `dockerode` API:

- `exec()` → `container.exec()` + `exec.start()`
- `openPTY()` → `container.exec({ Tty: true, AttachStdin: true })` + `exec.start({ hijack: true })`
- `writeFile()` → exec `bash -c "cat > path"` with stdin
- `readFile()` → exec `cat path`
- `fileExists()` → exec `test -e path`
- `destroy()` → no-op (container lifecycle managed separately)

### SSHTransport

Wraps the `ssh2` library (pure JavaScript, no native dependencies):

- `exec()` → `client.exec()` channel
- `openPTY()` → `client.shell({ term: 'xterm-256color' })` with PTY request
- `writeFile()` → SFTP subsystem `writeFile()`
- `readFile()` → SFTP subsystem `readFile()`
- `fileExists()` → SFTP `stat()` with catch
- `destroy()` → `client.end()`

### Connection Management

- **Short-lived connections for exec/file operations.** SSH connections are opened per-operation and closed after. This avoids stale connection issues, reconnection logic, and resource leaks.
- **Long-lived connections for PTY sessions.** Terminal sessions (`openPTY`) keep the SSH connection alive for the duration of the user's browser tab. The connection is cleaned up when the WebSocket closes.
- **Docker transport** uses the existing singleton `dockerode` instance (local Unix socket).

---

## 6. Agent Runtime

The `AgentRuntime` interface sits between the machine registry and the Transport. It handles agent lifecycle operations that differ per machine type.

```typescript
interface AgentRuntimeOptions {
  name: string;
  machineId: string;
  env: Record<string, string>;             // ANTHROPIC_API_KEY, GITHUB_TOKEN, etc.
  devPort?: number;
}

interface AgentRuntime {
  create(options: AgentRuntimeOptions): Promise<{ remoteId: string; hostPort?: number }>;
  stop(remoteId: string): Promise<void>;
  remove(remoteId: string): Promise<void>;
  getTransport(remoteId: string): Promise<Transport>;
  isRunning(remoteId: string): Promise<boolean>;
}
```

### DockerAgentRuntime

- `create()` → pull image, `docker.createContainer()` with labels/env/ports, `container.start()`
- `stop()` → `container.stop()`
- `remove()` → `container.stop()` + `container.remove()`
- `getTransport()` → returns a `DockerTransport` wrapping the container
- `isRunning()` → `container.inspect()` checks `State.Running`
- Filters containers by `dindang.managed` label to avoid touching unrelated containers

### SSHAgentRuntime

- `create()` → no-op (the machine IS the environment). Environment variables written to `~/.dindang-env` (mode `0o600`), sourced in shell profile.
- `stop()` → kills running Claude Code processes
- `remove()` → cleans up working directory, env file, hooks config
- `getTransport()` → returns a new `SSHTransport` connected to the machine
- `isRunning()` → SSH connectivity check

---

## 7. Agent Setup (Transport-Agnostic)

The current `setupContainer()` becomes `setupAgent()` — same logic, using Transport instead of Docker-specific APIs.

```typescript
interface AgentSetupOptions {
  name: string;
  repoUrl: string;
  workDir: string;
  githubToken?: string;
  setupCommand?: string;
  callbackUrl: string;
  onProgress?: (message: string) => void;
}

async function setupAgent(transport: Transport, options: AgentSetupOptions): Promise<void> {
  const { onProgress = () => {} } = options;

  // Step 1: Check/install system dependencies
  const hasGit = await transport.exec(["which", "git"]);
  if (hasGit.exitCode !== 0) {
    onProgress("Installing system dependencies...");
    await transport.exec(["bash", "-c", "apt-get update -qq && apt-get install -y -qq git curl build-essential"]);
  }

  // Step 2: Check/install Claude Code
  const hasClaude = await transport.exec(["which", "claude"]);
  if (hasClaude.exitCode !== 0) {
    onProgress("Installing Claude Code...");
    await transport.exec(["bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"]);
    await transport.exec(["bash", "-c",
      "ln -sf $(which claude 2>/dev/null || echo $HOME/.local/bin/claude) /usr/local/bin/claude"]);
  }

  // Step 3: Configure git credentials (if token provided)
  if (options.githubToken) {
    await transport.exec([
      "git", "config", "--global", "credential.helper",
      "!f() { test \"$1\" = get && echo protocol=https && echo host=github.com && echo username=x-access-token && echo password=$GITHUB_TOKEN; }; f",
    ]);
  }

  // Step 4: Clone repo (if not already present)
  const repoExists = await transport.fileExists(options.workDir);
  if (!repoExists) {
    onProgress(`Cloning ${options.repoUrl}...`);
    await transport.exec(["git", "clone", options.repoUrl, options.workDir]);
  }

  // Step 5: Write hooks config
  const hooksConfig = JSON.stringify({
    hooks: {
      PostToolUse: [{ hooks: [{ type: "http", url: `${options.callbackUrl}/api/hooks/agent/${options.name}` }] }],
      Stop: [{ hooks: [{ type: "http", url: `${options.callbackUrl}/api/hooks/agent/${options.name}` }] }],
    },
  });
  await transport.writeFile(`${options.workDir}/.claude/settings.json`, hooksConfig);

  // Step 6: Run user setup command (if provided)
  if (options.setupCommand) {
    onProgress(`Running setup: ${options.setupCommand}`);
    await transport.exec(["bash", "-c", options.setupCommand], { cwd: options.workDir });
  }

  onProgress("Ready.");
}
```

**Progressive** — checks before acting. Works whether the user provides a bare VM or a fully prepped environment.

**Repo URL validation** stays in the agent creation path (in `agents.ts`), above the transport layer.

**Callback URL** computed per machine type: `host.docker.internal:<port>` for Docker, dindang server's network-reachable address for SSH.

---

## 8. Terminal Connection

The WebSocket terminal handler becomes transport-aware:

```
Browser ↔ WebSocket ↔ dindang server ↔ Transport.openPTY() ↔ machine
```

Flow:

1. WebSocket upgrade handler validates the Supabase session (reject unauthenticated)
2. Looks up agent record from DB to get `machineId`, `workDir`, `orgId`
3. Verifies the user is a member of the agent's org
4. Resolves machine → `AgentRuntime` → `Transport`
5. Calls `transport.openPTY({ cwd: agent.workDir })`
6. Pipes WebSocket ↔ PTY stream bidirectionally
7. Handles resize messages via `ptySession.resize()`

The xterm.js frontend is unchanged.

### Dev Port Forwarding

- **Docker machines:** Port mapping via Docker's `HostPort: "0"`. Host port stored in agent record.
- **SSH machines:** SSH local port forwarding via `ssh2`. Dindang allocates a local port, binds to `127.0.0.1` only (never `0.0.0.0`), tunnels to the dev port on the remote machine.
  - **Tunnel lifecycle:** Created when agent enters `ready` status. Torn down on stop/remove.
  - **Idle timeout:** 30 minutes with no traffic → tunnel closed, recreated on demand.
  - **Port restriction:** Only the configured `devPort` can be tunneled.
  - **Reverse forwarding rejected:** `ssh2` client denies `tcpip-forward` requests from remote hosts.

---

## 9. Security Model

### Credential Encryption

See Section 4 for full details. Summary:

- Server secret via `DINDANG_ENCRYPTION_SECRET` env var (required, server refuses to start without it)
- Per-user keys for personal credentials (GitHub/Anthropic tokens)
- Per-org keys for shared credentials (SSH keys on machines)
- AES-256-GCM, scrypt N=65536, decrypt only at moment of use

### SSH Connection Security

- **Host key verification (explicit TOFU):** On "Test Connection", the host key fingerprint is displayed in the UI. User must click "Trust this host" to save it. Subsequent connections reject mismatches.
- **Manual fingerprint entry:** Users can paste a fingerprint during registration, bypassing TOFU.
- **Auth methods:** Key-based (recommended, presented first) and password.
- **No agent forwarding:** Explicitly disabled to prevent credential relay attacks.
- **Timeouts:** 30s handshake, 10s idle keepalive.

### SSH Tunnel Security

- **Bind to `127.0.0.1` only** — never `0.0.0.0`
- **Only configured `devPort`** — no arbitrary port forwarding
- **Reverse forwarding rejected**
- **Session caps:** Max 10 concurrent tunnels per instance (configurable)
- **Idle timeout:** 30 minutes

### Agent Isolation

- Each registered machine = one isolation boundary
- Docker: container boundaries (current behavior)
- SSH: the machine itself is the boundary
- Dindang does not sandbox within a machine — that is the user's responsibility

### Network Security

- SSH connections are outbound only from dindang to registered machines
- Dev port forwarding uses SSH tunnels — remote ports not publicly exposed
- Webhook callbacks use configured callback URL

### Input Validation

- Machine hostnames validated against RFC 952
- SSH ports validated 1-65535
- Machine names: alphanumeric + hyphens only
- Repo URLs validated against host allowlist (github.com, gitlab.com, bitbucket.org)
- Shell commands: user-provided strings passed as array arguments, never interpolated

### Auth Security

- All server functions require valid Supabase session
- WebSocket upgrade validates session before allowing terminal connections
- RLS ensures users can only access their own org's data
- Role checks enforced in application layer (not just RLS)
- GitHub OAuth tokens scoped to `repo` — minimal necessary scope

---

## 10. Machine Registration & Connection Management

### Registration Flow

1. Navigate to Settings → Machines
2. Click "Add Machine"
3. Select type: Docker (local) or SSH (remote)
4. For SSH: enter host, port (default 22), username, credential (key or password)
5. Click "Test Connection" — connectivity check runs
6. On success: host key fingerprint displayed, user clicks "Trust this host"
7. Machine saved with fingerprint, appears with status "connected"

### Status Checking

- Checked lazily — on listing machines or creating an agent
- No background polling
- Values: `connected`, `unreachable`, `unknown`

### Local Docker Auto-Detection

- On startup, check if Docker daemon is reachable via Unix socket
- If reachable, auto-register "Local Docker" machine (`type: "docker"`, `host: null`)
- Can be toggled off (`enabled: false`) but not removed
- If Docker unavailable, no default machine — user must register SSH machines

---

## 11. UI Changes

### New: Login Page (`/login`)

- Two OAuth buttons: "Sign in with GitHub", "Sign in with Google"
- Redirects to dashboard on success
- Auto-creates org on first login

### Settings Page

**Machines section** (new):
- Machine list with name, type, host, status badge
- Add/edit/remove forms
- "Test Connection" button with fingerprint confirmation dialog
- Local Docker shown as built-in toggle

**Projects section** (updated):
- Same as current, but data comes from Postgres instead of config file

**Team section** (new):
- Member list with roles
- Invite by email
- Role management (Owner only can change roles)
- Leave org / remove member

**Credentials section** (updated):
- GitHub token: auto-populated from OAuth, or manual entry for Google-auth users
- Anthropic API key: manual entry
- Shows "configured" status, never raw values

### Dashboard

- Project dropdown + Machine dropdown + "new" button
- Machine dropdown shows name and status
- Defaults to local Docker or only registered machine
- Disabled/unreachable machines greyed out

### Agent Detail Page

- No visual changes to terminal
- Host port link adapts per transport type

---

## 12. Future Extension: Cloud Provider Integration

The architecture supports cloud provider integration without structural changes. **Out of scope for this spec.**

### Concept

Users connect a cloud account (AWS, Azure, GCP). Dindang provisions VMs on demand — spinning up when agents are created, tearing down when removed.

### Extension Points

- `machines.type` extends to `"aws"`, `"azure"`, `"gcp"`, etc.
- `CloudProvisioner` interface:

```typescript
interface CloudProvisioner {
  provision(config: VMConfig): Promise<{ host: string; username: string; key: string }>;
  deprovision(instanceId: string): Promise<void>;
  getStatus(instanceId: string): Promise<"running" | "stopped" | "terminated">;
}
```

- Flow: `provisioner.provision()` → register as SSH machine → normal SSH transport from there
- Cloud credentials stored in a new `cloud_accounts` table, encrypted with org-derived key

### Why This Works

Cloud provisioning adds a step **before** machine registration. Once a VM exists, it's just an SSH machine. Transport, setup, terminal, and security are all unchanged.

---

## 13. Migration Path

### From Current Architecture

1. **Local config file** → Postgres tables via Drizzle. `config.ts` removed.
2. **Local key file** (`~/.dindang/.key`) → `DINDANG_ENCRYPTION_SECRET` env var. `crypto.ts` updated.
3. **`DeploymentProvider`** → `Transport` + `AgentRuntime` + machine registry
4. **`docker-provider.ts`** → split into `transports/docker.ts`, `runtimes/docker.ts`
5. **In-memory `agentMeta`** → persistent `agents` table in Postgres
6. **Server functions** → updated to query Supabase, check auth, enforce roles
7. **Terminal handler** → validates session, resolves agent → machine → transport
8. **Setup logic** → extracted into transport-agnostic `setupAgent`

### New Infrastructure Requirements

- Supabase project (Auth + Postgres)
- Environment variables: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DINDANG_ENCRYPTION_SECRET`
- GitHub OAuth app configured in Supabase dashboard
- Google OAuth app configured in Supabase dashboard

---

## 14. Dependencies

### New Dependencies

- `@supabase/supabase-js` — Supabase client (auth, realtime)
- `@supabase/ssr` — Server-side auth helpers for cookie-based sessions
- `drizzle-orm` — TypeScript ORM for Postgres
- `drizzle-kit` — Migration CLI
- `postgres` — PostgreSQL driver (postgres.js, used by Drizzle)
- `ssh2` — Pure JS SSH2 client (connections, SFTP, PTY, port forwarding)

### Existing Dependencies (unchanged)

- `dockerode` — Docker API client
- `ws` — WebSocket server
- `@xterm/xterm` — Terminal emulator

### Removed Dependencies

- None removed, but `src/lib/config.ts` (local config file read/write) is deleted

---

## 15. File Structure

```
src/
  db/
    index.ts              — Drizzle client, Supabase client
    schema.ts             — Drizzle table definitions
    migrations/           — Generated by drizzle-kit
  lib/
    types.ts              — Agent, Machine, AgentStatus, etc.
    transport.ts          — Transport, PTYSession, ExecResult interfaces
    crypto.ts             — updated: per-user/per-org key derivation from DINDANG_ENCRYPTION_SECRET
    errors.ts             — toErrorMessage helper (unchanged)
  server/
    auth.ts               — Supabase session middleware, role checks
    transports/
      docker.ts           — DockerTransport implementation
      ssh.ts              — SSHTransport implementation
    runtimes/
      docker.ts           — DockerAgentRuntime (container lifecycle)
      ssh.ts              — SSHAgentRuntime (process lifecycle)
    machine-registry.ts   — machine CRUD, status checks, runtime factory
    agent-setup.ts        — transport-agnostic setupAgent logic
    agents.ts             — agent server functions (create, list, stop, remove)
    terminal.ts           — WebSocket terminal (auth + transport resolution)
    settings.ts           — project, machine, credential, team server functions
  routes/
    login.tsx             — OAuth login page
    settings.tsx          — Machines, Projects, Team, Credentials sections
    index.tsx             — Dashboard with machine + project dropdowns
    agent.$name.tsx       — Agent detail with terminal (unchanged)
  components/
    machine-card.tsx      — Machine list item
    machine-form.tsx      — Add/edit machine form
    member-list.tsx       — Org member management
```

### Removed Files

- `src/lib/config.ts` — replaced by Drizzle queries
- `src/lib/provider.ts` — replaced by Transport + AgentRuntime interfaces
- `src/server/docker-provider.ts` — split into transports/docker.ts + runtimes/docker.ts
