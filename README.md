# dindang

Web platform for spawning and managing AI coding agents (Claude Code, Codex CLI) on remote machines. Configure projects and machines, then spin up containerized agents that clone repos, install tools, and present a live terminal in the browser.

## Quick Start

Requires [Docker](https://docs.docker.com/get-docker/).

```bash
curl -O https://raw.githubusercontent.com/runa/dindang/master/docker-compose.yml
docker compose up
```

Open [http://localhost:3000](http://localhost:3000).

On first run, dindang will:
- Start a Postgres database
- Apply the database schema
- Generate an encryption secret (persisted in a Docker volume)
- Start the app on port 3000

No account or login required in local mode.

## Configuration

Set environment variables in a `.env` file next to `docker-compose.yml`, or pass them directly.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DINDANG_ENCRYPTION_SECRET` | No | Auto-generated | Secret for encrypting stored credentials. Auto-generated and persisted on first run if not set. |
| `DINDANG_CALLBACK_URL` | No | `http://host.docker.internal:3000` | URL agents use to call back to the server |

## How It Works

1. **Configure a project** in settings — repo URL, setup command, which AI CLI to use
2. **Configure a machine** — local Docker, remote Docker over SSH, or direct SSH terminal
3. **Spawn an agent** — dindang creates a container, clones your repo, installs the AI CLI, and runs your setup command
4. **Use the terminal** — interact with your agent through a live terminal in the browser
5. **Preview** — dev server ports are proxied back to your browser

## Development

To work on dindang itself:

```bash
git clone https://github.com/runa/dindang.git
cd dindang
npm install

# Start just the database
docker compose up postgres -d

# Copy env config
cp .env.example .env

# Apply database schema
npx drizzle-kit push

# Start dev server
npm run dev
```

### Commands

```bash
npm run dev          # Dev server on port 3000 (with HMR)
npm run build        # Production build (client + server)
npm start            # Run production server
npm test             # Run tests
```

## Hosted Mode

dindang can run as a multi-user service with Supabase authentication. Set `DINDANG_MODE=hosted` and configure Supabase:

```
DINDANG_MODE=hosted
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
DINDANG_ENCRYPTION_SECRET=your-secret-here
```

Hosted mode adds GitHub/Google OAuth login, team management, and GitHub OAuth integration for repo access.

## Stack

- **Frontend**: React 19, TanStack Router/Start, Tailwind CSS 4, xterm.js
- **Backend**: Vite + TanStack Start server functions
- **Database**: PostgreSQL + Drizzle ORM
- **Containers**: Docker (local or remote via SSH)

## License

AGPL-3.0 — see [LICENSE](LICENSE) for details.
