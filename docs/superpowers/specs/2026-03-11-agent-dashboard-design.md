# Agent Dashboard POC — Design Spec

## Purpose

A web dashboard for senior+ developers to coordinate multiple AI agent instances. Users can one-click deploy agent containers, assign tasks via prompts, and monitor status — replacing the current workflow of managing agents across VM terminal sessions.

## Target User

Senior+ developers focused on execution and coordination. Minimal UI, dense information, no hand-holding.

## Tech Stack

- **Framework**: TanStack Start (full-stack React with server functions)
- **Docker API**: dockerode (Node.js Docker client)
- **Persistence**: None — Docker containers are the source of truth
- **Styling**: Minimal, terminal-inspired, monospace, dark theme

## Architecture

```
Browser (React) <-> TanStack Server Functions <-> DeploymentProvider <-> Docker Engine
```

No database. Container state is queried directly from Docker. Containers are labeled (`dindang.managed=true`) to distinguish them from other running containers.

## Deployment Provider Abstraction

The deployment target is pluggable. POC ships with `DockerProvider`. Companies can later implement their own provider (Kubernetes, EC2, Fly, etc.).

```ts
interface DeploymentProvider {
  create(name: string): Promise<Agent>
  start(id: string, command: string): Promise<void>
  stop(id: string): Promise<void>
  remove(id: string): Promise<void>
  getStatus(id: string): Promise<AgentStatus>
  streamLogs(id: string): AsyncIterable<string>
  list(): Promise<Agent[]>
}
```

### Agent & Status Types

```ts
interface Agent {
  id: string
  name: string
  status: AgentStatus
  command?: string
  createdAt: string
}

type AgentStatus = 'idle' | 'running' | 'done' | 'error'
```

## Pages

### `/` — Dashboard

- Flex grid of agent cards
- `+` button to create a new agent (random name, e.g. `bold-falcon`)
- Each card shows: name, status badge, created time, one-line command preview
- Clicking a card navigates to `/agent/:id`

### `/agent/:id` — Agent Detail

- Container name, status, full command
- Live log stream (stdout/stderr via Docker logs API, streamed to browser via SSE)
- Prompt input: text field to enter a shell command, hit "Run"
- Action buttons: Start, Stop, Remove
- Remove navigates back to dashboard

## Card States

| State     | Meaning                              | Badge Color |
|-----------|--------------------------------------|-------------|
| `idle`    | Container created, not yet started   | Gray        |
| `running` | Container executing a command        | Blue        |
| `done`    | Command finished successfully        | Green       |
| `error`   | Command failed (non-zero exit code)  | Red         |

## Container Strategy

- **Base image**: `debian:bookworm-slim`
- **Creation**: Container created on `+` click, not started
- **Execution**: `bash -c "<user command>"` when user provides prompt and hits Run
- **Labeling**: `dindang.managed=true` label on all managed containers
- **Logs**: Streamed via `container.logs({ follow: true, stdout: true, stderr: true })`

## What's NOT in the POC

- Authentication / multi-user
- Persistent storage / database
- Actual AI agent integration (BYOM — future)
- Embedded terminal / xterm.js (future — container architecture supports it)
- SSH access (future — containers support it)
- Custom container images
- Deployment to production

## Future Vision

- **BYOM (Bring Your Own Model)**: Users pick their agent runtime (Claude Code, etc.) to run in the container terminal
- **SSH access**: Users can shell into any container for manual intervention
- **Pluggable deployment**: Companies hook in their own infrastructure (K8s, cloud VMs, etc.)
- **Embedded terminal**: xterm.js for in-browser terminal access
