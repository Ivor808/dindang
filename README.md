# dindang

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-required-blue?logo=docker)](https://docs.docker.com/get-docker/)

**Run a team of AI coding agents in parallel — each in its own container, branch, and dev environment.**

Spawn agents that clone your repo, set up the project, and work independently on different tasks. Watch them all from a single dashboard with live terminals in the browser.

<img width="1271" height="570" alt="image" src="https://github.com/user-attachments/assets/f7c8d792-831b-4175-8424-4a743593260c" />

<img width="1509" height="499" alt="Screenshot 2026-03-17 at 11 35 07 PM" src="https://github.com/user-attachments/assets/27f9bc31-9d72-4aae-b004-b35a1f0e35f4" />

<img width="544" height="228" alt="image" src="https://github.com/user-attachments/assets/27469688-40de-4082-b5dc-2f75486acee4" />

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/Ivor808/dindang/master/install.sh | sh
```

Open [http://localhost:3000](http://localhost:3000). Requires [Docker](https://docs.docker.com/get-docker/).

Run the same command again to update to the latest version.

## Features

- **Isolated containers** — each agent gets its own Docker container, git branch, and `docker compose` namespace. No conflicts between agents working on the same project.
- **Live browser terminal** — watch agents work in real-time via xterm.js.
- **Dev server preview** — each agent's dev server port is published and accessible from your browser.
- **Multi-machine** — run agents on local Docker, remote servers via SSH, or direct SSH terminals.
- **Infrastructure isolation** — each agent's `docker compose up` is automatically namespaced, so agents can stand up their own databases, caches, and services without stepping on each other.

## Why Not Just Worktrees?

Most multi-agent tools use git worktrees — multiple checkouts on the same machine sharing the same filesystem, network, and Docker daemon. This works for simple projects but breaks down when your project has real infrastructure:

| | Worktrees | dindang |
|---|---|---|
| Git branch isolation | Yes | Yes |
| Separate dependencies | No — shared filesystem | Yes — each container has its own |
| Database / Docker Compose | Shared — agents conflict | Namespaced per agent |
| Dev server ports | Conflict unless manually offset | Each agent gets its own port |
| Remote machines | Same machine only | SSH to any server |

If your project runs `docker compose up` with Postgres, Redis, or a microservice stack — you need real isolation, not just separate git checkouts.

## Works With

- [Claude Code](https://github.com/anthropics/claude-code) by Anthropic
- [Codex CLI](https://github.com/openai/codex) by OpenAI
- Any terminal-based AI coding tool

## How It Works

dindang creates a Docker container per agent, clones your repo, installs the AI CLI, and runs your project's setup command. A WebSocket bridge streams each terminal to the browser. Each container gets `COMPOSE_PROJECT_NAME` set to the agent name, so any Docker Compose services the project needs are fully isolated per agent. Credentials are encrypted at rest.

## Machine Types

dindang supports three machine types. You can mix and match them — run some agents locally and others on remote servers.

### Local Docker (default)

Agents run as Docker containers on the same machine as dindang. This is the zero-config option — no SSH keys or remote servers needed.

**How it works:** dindang talks to the Docker daemon via the Docker socket (`/var/run/docker.sock`). Each agent gets its own container with an isolated filesystem, network namespace, and `COMPOSE_PROJECT_NAME`.

**Setup:** The Quick Start above is all you need. The default `docker-compose.yml` mounts the Docker socket and sets `DINDANG_MODE=local`. A "Local Docker" machine is auto-created on first run.

**Requirements:**
- Docker installed on the host
- The dindang container (or dev server) must have access to the Docker socket

### Server (Docker over SSH)

Agents run as Docker containers on a remote machine. dindang SSHes into the remote host, creates containers via `docker` CLI commands, and streams the terminal back to your browser.

**How it works:** dindang establishes an SSH connection to the remote host, runs `docker create`/`docker exec` commands, and tunnels PTY streams over SSH. The remote machine needs Docker installed — dindang handles everything else.

**Setup:**

1. Ensure the remote machine has Docker installed and running
2. Ensure the SSH user can run `docker` commands (add them to the `docker` group or use root)
3. In dindang, go to **Settings > Machines** and add a new machine:
   - **Type:** Server
   - **Host:** IP address or hostname of the remote machine
   - **Port:** SSH port (default 22)
   - **Username:** SSH user
   - **Auth method:** SSH key (paste your private key) or password
4. Select the new machine when creating agents

**Requirements:**
- Docker installed on the remote machine
- SSH access with a user that can run `docker` commands
- Network connectivity from dindang to the remote host on the SSH port
- For dev server preview: the remote machine's dev port must be reachable from the browser

### Terminal (direct SSH)

Agents run directly on a remote machine via SSH — no Docker on the remote side. dindang SSHes in and gives you a terminal session. Useful for machines where you can't or don't want to install Docker.

**How it works:** dindang establishes an SSH connection and opens a PTY shell. The agent runs directly in the remote user's environment with tmux for session management.

**Setup:**

1. In dindang, go to **Settings > Machines** and add a new machine:
   - **Type:** Terminal
   - **Host:** IP address or hostname
   - **Port:** SSH port (default 22)
   - **Username:** SSH user
   - **Auth method:** SSH key or password
2. Select the machine when creating agents

**Requirements:**
- SSH access to the remote machine
- `tmux` installed on the remote machine
- The AI CLI (Claude Code, Codex, etc.) should be pre-installed on the remote machine, or the setup command in your project config should install it

### Comparison

| | Local Docker | Server | Terminal |
|---|---|---|---|
| Remote host Docker required | No (runs locally) | Yes | No |
| Container isolation | Yes | Yes | No |
| Infrastructure namespace | Yes (`COMPOSE_PROJECT_NAME`) | Yes | No |
| SSH required | No | Yes | Yes |
| Dev server preview | Via published port | Via remote host:port | Manual |
| Best for | Single-machine setups | Scaling to remote GPU/cloud machines | Lightweight SSH access |

## Development

```bash
git clone https://github.com/Ivor808/dindang.git
cd dindang
npm install
docker compose up postgres -d
cp .env.example .env
npx drizzle-kit push
npm run dev
```

```bash
npm run dev          # Dev server on port 3000
npm run build        # Production build
npm start            # Production server
npm test             # Run tests
```

## Contributing

Contributions welcome. Open an issue or submit a PR.

## License

AGPL-3.0 — see [LICENSE](LICENSE) for details.
