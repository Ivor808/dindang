# Server Machine Type Design

**Date**: 2026-03-14
**Status**: Draft

## Problem

Dindang currently has two machine types:

- **Docker** — connects to the local Docker socket. Only works when dindang runs on the same machine as Docker. Not useful for a hosted product.
- **SSH** — raw terminal access to a remote machine. No container management; users manage everything themselves.

The primary use case — "I have a home server, dindang should manage Docker containers on it" — is not supported. Users must manually install Docker, configure networking, and manage containers themselves.

## User Personas

Three tiers of users, served by three machine modes:

1. **Server** (primary, new) — "I have a server. Connect to it and manage everything for me." User provides SSH credentials; dindang installs Docker, creates isolated containers per agent, handles port mappings and volumes.

2. **Terminal** (power user, existing SSH renamed) — "I have my own infrastructure, just give me terminal access." No container management. Raw SSH access. User manages everything.

3. **Local** (future desktop app, existing Docker) — Uses the local Docker socket directly. Not exposed in the hosted product; reserved for a future desktop app.

## Design

### Machine Type Enum

Update the `machines.type` column from `"docker" | "ssh"` to `"server" | "terminal" | "local"`:

- `"server"` — Remote Docker over SSH (new)
- `"terminal"` — Raw SSH terminal access (renamed from `"ssh"`)
- `"local"` — Local Docker socket (renamed from `"docker"`)

The column is already `text` in Postgres (Drizzle's `enum` is application-level only), so migration is just `UPDATE` statements. The SQL migration must run before the code deployment to avoid enum mismatches.

### UI Changes

**Settings > Machines tab:**

The "Type" dropdown shows:

- **Server** — "dindang manages Docker containers on your server"
- **Terminal** — "Direct terminal access to your own infrastructure"

"Local" is hidden in the hosted product (only available in desktop app builds).

Both Server and Terminal show the same SSH credential fields:
- Host, Port (default 22), Username, Auth method (key/password), Credential

The difference is behavioral, not in the form fields.

**Machine cards** show:
- Server: host, status, number of running agents
- Terminal: host, status

### ServerAgentRuntime

New runtime that SSHs into the server and manages Docker remotely via CLI commands (not the Docker TCP API — simpler, no need to expose port 2376).

#### Docker Bootstrap (first use)

When the first agent is created on a Server machine, dindang checks if Docker is installed:

```
docker info 2>/dev/null
```

If Docker is present, proceed. If not, check for passwordless sudo:

```
sudo -n true
```

If sudo is available, install Docker Engine via the official convenience script:

```
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker {username}
```

If sudo is NOT available, fail with a helpful error message telling the user to either:
1. Install Docker manually on the server
2. Enable passwordless sudo for their user

The `usermod` group change does not take effect until a new SSH session. After install, subsequent Docker commands in the same session use `sudo docker` until the user reconnects. The runtime handles this transparently.

The `{username}` is passed explicitly from the machine record, not via `$USER` shell expansion.

Docker readiness is checked on first agent creation and cached in memory per runtime instance. No database flag — the check is cheap (`docker info` takes <1s) and avoids stale state from Docker being uninstalled or the daemon stopping.

#### Image Pull

Before creating a container, explicitly pull the base image:

```
docker pull node:22-slim
```

This avoids a long timeout on first use when `docker run` would implicitly pull. Progress is not streamed to the user (SSH exec is fire-and-forget), but the agent status remains "provisioning" until setup completes.

#### Container Lifecycle

All Docker commands run over SSH. Container names are prefixed with the org ID to prevent collisions when multiple dindang instances target the same server.

- **create**: `docker run -d --name {orgId}-{name} -v dindang-{orgId}-{name}:/home -p 0:{devPort} -e KEY=VAL node:22-slim bash -c 'trap exit TERM; while true; do sleep 1; done'`
- **stop**: `docker stop {orgId}-{name}`
- **remove**: `docker rm -f {orgId}-{name} && docker volume rm dindang-{orgId}-{name}`
- **redeploy**: stop + remove container (keep volume) + create with same volume
- **exec**: `docker exec {orgId}-{name} {cmd}`
- **PTY**: See PTY section below

Note: Port mapping syntax is `-p 0:{devPort}` — bind a random host port to the container's dev port. This matches the existing `DockerAgentRuntime` behavior (`HostPort: "0"`).

#### Transport

`ServerTransport` wraps commands in `docker exec` over SSH. It composes an `SSHTransport` internally for the SSH connection layer.

- `exec(cmd)` → SSH exec: `docker exec {containerId} cmd`
- `openPTY()` → See PTY section below
- `writeFile(path, content)` → SSH exec: `docker exec -i {containerId} bash -c 'base64 -d > {path}'` with base64-encoded content piped via SSH stdin. This is binary-safe and avoids shell quoting issues.
- `readFile(path)` → SSH exec: `docker exec {containerId} cat {path}`
- `fileExists(path)` → SSH exec: `docker exec {containerId} test -e {path}`

#### PTY (Double-Nesting)

`openPTY()` creates a nested PTY chain: xterm.js → WebSocket → SSH PTY → `docker exec -it` → bash.

Implementation: Open an SSH shell (PTY-allocated), then write `docker exec -it {containerId} bash` as a command into the shell stream. This gives a proper TTY chain where the outer SSH PTY propagates resize events to the inner container TTY automatically.

`resize()` calls `channel.setWindow()` on the SSH channel, which propagates through to the container's TTY via the kernel's SIGWINCH handling.

This double-nesting is a known pattern (e.g., `ssh host docker exec -it ...` works in any terminal). No special handling needed beyond the standard SSH PTY flow.

#### Port Forwarding

When a container has a dev port mapped, the host port is dynamically assigned. The `ServerAgentRuntime` queries:

```
docker port {orgId}-{name} {devPort}
```

This returns the host port (e.g., `0.0.0.0:32768`). The agent record stores this `hostPort` for the UI link.

For users to access the dev server from their browser, the server's firewall must allow the dynamically assigned port range. Start with direct port access; add SSH tunneling later if needed.

#### Callback URL

The `callbackUrl` used for Claude Code hooks (PostToolUse, Stop) must be reachable from inside the remote container. The current fallback `http://host.docker.internal:3000` only works for Docker Desktop on the same machine.

For Server machines, `DINDANG_CALLBACK_URL` must be set to a URL reachable from the remote server (e.g., the dindang server's public IP or Tailscale IP). This is a deployment requirement documented in `.env.example`.

If `DINDANG_CALLBACK_URL` is not set and the machine type is `"server"`, agent setup skips hooks configuration rather than writing an unreachable URL. The agent works but without activity tracking.

#### SSH Connection Reuse

`ServerAgentRuntime` holds a single SSH connection per lifecycle operation (create, redeploy, remove). The `create` flow (pull + run + port query) reuses one SSH session rather than opening three separate handshakes. The connection is closed after the operation completes.

For `getTransport()`, a new SSH connection is created per transport instance (same as existing `SSHAgentRuntime`). PTY sessions are long-lived and hold their own connection.

### Persistence

Same volume model as local Docker:

- Named volume: `dindang-{orgId}-{agentName}:/home`
- Repos cloned into `/home/{repoName}`
- Volume survives container redeploy
- Volume removed on agent delete

### Agent Setup

Reuses `setupAgent()` unchanged — it's already transport-agnostic. The `ServerTransport` provides the same `Transport` interface, so clone, install deps, install Claude Code all work identically.

### Schema Changes

```sql
-- Rename existing enum values (column is already text, no ALTER needed)
UPDATE machines SET type = 'local' WHERE type = 'docker';
UPDATE machines SET type = 'terminal' WHERE type = 'ssh';
```

Drizzle schema update:

```typescript
export const machines = pgTable("machines", {
  // ...existing fields...
  type: text("type", { enum: ["server", "terminal", "local"] }).notNull(),
});
```

No `dockerReady` column — Docker readiness is checked at runtime and cached in memory.

### File Changes

| File | Change |
|------|--------|
| `src/db/schema.ts` | Update type enum |
| `src/lib/transport.ts` | No changes (interfaces unchanged) |
| `src/server/runtimes/server.ts` | **New** — `ServerAgentRuntime` |
| `src/server/transports/server.ts` | **New** — `ServerTransport` (SSH + docker exec) |
| `src/server/machine-registry.ts` | Add `"server"` case to `getRuntimeForMachine()`, update `createMachine()` and `updateMachine()` type signatures |
| `src/server/runtimes/docker.ts` | Rename references, keep for `"local"` type |
| `src/server/runtimes/ssh.ts` | Rename references, keep for `"terminal"` type |
| `src/routes/settings.tsx` | Update type labels and form |
| `src/components/machine-card.tsx` | Update type display |
| `src/routes/index.tsx` | Update machine dropdown labels |

### Security

- SSH credentials encrypted with org-scoped key (existing pattern)
- All Docker commands passed as arrays to `SSHTransport.exec()`, which shell-escapes each argument via single-quote wrapping. Note: SSH exec does involve shell interpretation on the remote host, but `shellEscape()` handles this safely.
- Environment variable keys validated against `/^[A-Za-z_][A-Za-z0-9_]*$/` before constructing shell commands. Values are shell-escaped.
- File paths in `writeFile`/`chmod` are shell-escaped to prevent injection.
- Container names prefixed with org ID to prevent naming collisions. This is a naming convention, not a security boundary — if two orgs share the same server, they can see each other's containers via `docker ps`. Assumption: each server is used by a single org.
- Container names validated alphanumeric+hyphens
- Docker install runs via `sudo` — user must have sudo access. Post-install, all Docker commands run without sudo (user must be in the `docker` group). Recommendation: document as a setup requirement that the SSH user be added to the `docker` group.
- No Docker TCP port exposed (all commands via SSH)
- `curl | sh` for Docker install is a supply-chain trust assumption (same pattern used for Claude Code install). Documented risk, accepted for convenience.
- `DINDANG_CALLBACK_URL` validated as HTTPS or localhost before writing to hooks config.
- SSH host key verification: the schema has `hostKeyFingerprint` for TOFU verification. Implementation should use `ssh2`'s `hostVerifier` callback to verify against stored fingerprint. On first connection with no stored fingerprint, store it (Trust On First Use).

### Testability

`ServerAgentRuntime` and `ServerTransport` are designed for dependency injection:

```typescript
// ServerTransport accepts a Transport (SSH layer) via constructor
class ServerTransport implements Transport {
  constructor(private ssh: Transport, private containerId: string) {}
}

// ServerAgentRuntime accepts a transport factory
type TransportFactory = (opts: SSHConnectionOptions) => Transport;
class ServerAgentRuntime implements AgentRuntime {
  constructor(private connectionOptions: SSHConnectionOptions, private createTransport?: TransportFactory) {}
}
```

This allows unit testing without real SSH connections by injecting mock transports.

### Test Strategy

#### Unit Tests

**ServerTransport command construction** (`src/server/transports/__tests__/server.test.ts`):
- `exec(["ls", "-la"])` produces correct `docker exec {containerId} ls -la` via SSH
- `writeFile` base64-encodes content and pipes via `docker exec -i`
- `readFile` and `fileExists` produce correct `docker exec` wrappers
- Special characters in file paths are shell-escaped
- Malicious env var values (containing single quotes, semicolons, backticks) are safely escaped
- Invalid env var keys are rejected

**ServerAgentRuntime lifecycle** (`src/server/runtimes/__tests__/server.test.ts`):
- `create()` checks `docker info`, installs Docker when missing, pulls image, runs container, queries port
- `create()` uses `sudo docker` when Docker was just installed
- `remove()` calls `docker rm -f` and `docker volume rm`
- `redeploy()` preserves volume, recreates container
- Error cases: Docker install fails, container create fails, SSH connection fails
- Org ID correctly prefixed on container names and volumes

**Input validation** (`src/server/__tests__/machine-registry.test.ts`):
- Machine host field rejects private IPs (127.x, 10.x, 172.16-31.x, 192.168.x) and cloud metadata IPs (169.254.169.254) for hosted deployments
- Env var key validation rejects shell metacharacters

#### Integration Tests (require Docker)

- Full lifecycle (create → exec → writeFile → readFile → redeploy → remove) using a mock SSH layer that runs Docker commands locally
- Agent setup flow (`setupAgent()`) through `ServerTransport` with a real container

### Error Handling

- Docker not installed + install fails → machine status "unreachable", error message shown
- SSH connection fails → machine status "unreachable"
- Container create fails → agent status "error"
- User lacks sudo for Docker install → clear error: "sudo access required for Docker installation"
- Callback URL not set for server machines → hooks skipped with warning, agent still functional

## Non-Goals

- Multi-node scheduling / load balancing across servers
- Kubernetes integration
- Docker TCP API exposure
- Desktop app / local mode (future work)
- SSH tunneling for dev port access (start with direct, add later)
- Health check / heartbeat for remote containers (check lazily on access)
