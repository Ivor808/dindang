# dindang

Orchestrate multiple AI coding agents working on your codebase in parallel. Each agent gets its own isolated container with a full copy of your project — separate branch, separate infrastructure, separate dev environment. Like having a team of developers, each working independently on different tasks.

## Quick Start

Requires [Docker](https://docs.docker.com/get-docker/).

```bash
curl -O https://raw.githubusercontent.com/runa/dindang/master/docker-compose.yml
docker compose up
```

Open [http://localhost:3000](http://localhost:3000).

## What It Does

1. **Configure a project** — repo URL, setup command, AI CLI (Claude Code or Codex)
2. **Spawn agents** — each gets its own container, branch, and isolated infrastructure
3. **Watch them work** — live terminals in the browser, status tracking, preview of dev servers
4. **Scale out** — run agents on local Docker, remote servers via SSH, or direct SSH terminals

Each agent's `docker compose up` is namespaced automatically — no conflicts between agents running the same project.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DINDANG_ENCRYPTION_SECRET` | Auto-generated | Encrypts stored credentials. Persisted on first run. |
| `DINDANG_CALLBACK_URL` | `http://host.docker.internal:3000` | How agents call back to dindang |

## Development

```bash
git clone https://github.com/runa/dindang.git
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

## License

AGPL-3.0 — see [LICENSE](LICENSE) for details.
