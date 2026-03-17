# dindang

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-required-blue?logo=docker)](https://docs.docker.com/get-docker/)

**Run a team of AI coding agents in parallel — each in its own container, branch, and dev environment.**

Spawn agents that clone your repo, set up the project, and work independently on different tasks. Watch them all from a single dashboard with live terminals in the browser.

<img width="1271" height="570" alt="image" src="https://github.com/user-attachments/assets/f7c8d792-831b-4175-8424-4a743593260c" />


## Quick Start

```bash
curl -O https://raw.githubusercontent.com/Ivor808/dindang/master/docker-compose.yml
docker compose up
```

Open [http://localhost:3000](http://localhost:3000). Requires [Docker](https://docs.docker.com/get-docker/).

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
