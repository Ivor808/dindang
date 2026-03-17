# Local Mode Design

## Problem

dindang requires Supabase for authentication, making self-hosting unnecessarily complex. Users who want to run dindang locally on their own machine must set up Supabase (or run `supabase start`) just to get past the login screen. For an open-source tool targeting developers, this friction kills adoption.

## Goal

Add a `local` mode where dindang works out of the box with just Docker and `npm run dev`. No Supabase, no OAuth, no login page. A single auto-created user owns everything.

## Approach

Swap the auth layer based on `DINDANG_MODE` (env var, defaults to `local`). The rest of the codebase stays unchanged — server functions still call `requireAuthWithOrg()` and get back `{ userId, orgId }`.

## Design

### 1. Mode Detection

A single env var `DINDANG_MODE` controls the mode:
- `local` (default) — no auth, single user, standalone Postgres
- `hosted` — current behavior: Supabase auth, teams, GitHub OAuth

Default to `local` so that cloning the repo and running `npm run dev` works without any `.env` configuration beyond `DATABASE_URL`.

Expose to client via `VITE_DINDANG_MODE` in `vite.config.ts`.

### 2. Auth Adapter (`src/server/auth.ts`)

Replace the current hard-coded Supabase auth with mode-based delegation:

- **`local` mode**: `requireAuth()` returns a fixed user ID (a deterministic UUID: `00000000-0000-0000-0000-000000000000`). `requireAuthWithOrg()` returns the fixed user ID and a fixed org ID (also deterministic). `requireRole()` always passes. `ensureOrg()` is bypassed entirely — the org is pre-seeded, so the Supabase code path that fetches user display name is never reached. No Supabase imports loaded.
- **`hosted` mode**: Current Supabase implementation, unchanged.

The function signatures remain identical. No changes needed in any calling code.

Supabase imports in `auth.ts` use dynamic `await import("@supabase/ssr")` inside the hosted-mode code path so they are never loaded in local mode.

### 3. Supabase Browser Client Facade (`src/lib/supabase-client.ts`)

Create a facade that centralizes all browser-side Supabase access:

```typescript
export function getSupabaseBrowserClient(): SupabaseClient | null
```

- In local mode: returns `null`
- In hosted mode: creates and returns a `createBrowserClient` instance

All frontend files (`__root.tsx`, `login.tsx`, `auth.callback.tsx`, `settings.tsx`) import from this facade instead of directly from `@supabase/ssr`. This solves the static import problem — the facade uses a dynamic `import()` internally, so `@supabase/ssr` is never bundled/loaded in local mode.

### 4. DB Seeding (`src/server/seed.ts`)

On first startup in local mode, seed the database with:
- One row in `orgs` with the fixed org ID and name "Local"
- One row in `orgMembers` linking the fixed user ID to the org as owner

There is no `users` table in the schema — Supabase manages users externally. The `userId` in `orgMembers` is just a bare UUID. Two inserts total.

This runs once via a check-and-insert pattern (idempotent). Called at app startup **before** `reconcileOnStartup()` in `lifecycle.ts`, since reconciliation queries tables that reference orgs.

### 5. Frontend Routing

**`__root.tsx`**:
- Use the Supabase facade. If `getSupabaseBrowserClient()` returns `null` (local mode), skip auth state management and always render the app.
- In hosted mode: current behavior

**`login.tsx`**:
- In local mode: redirect to `/` immediately (root layout won't redirect here, but guard against direct navigation)

**`auth.callback.tsx`**:
- In local mode: redirect to `/` (dead route but harmless)

Both `login.tsx` and `auth.callback.tsx` use the facade for Supabase access, avoiding top-level static imports.

### 6. Settings Page

**Credentials tab**:
- Local mode: Show GitHub PAT text input (users trust their own machine)
- Hosted mode: Show "Connect GitHub" OAuth button (current implementation)

**Team tab**:
- Local mode: Hide entirely (single user, no teams)
- Hosted mode: Current behavior

**Settings loader**:
- In local mode, skip the `listMembers()` call (no team tab, no need to fetch)

Detection via `import.meta.env.VITE_DINDANG_MODE` on the client. Settings link in nav bar stays visible in both modes (projects, machines, credentials are all relevant locally).

### 7. Nav Bar

- Local mode: Hide "sign out" button and email display. Keep "settings" link.
- Hosted mode: Current behavior

### 8. Distribution & Docker Compose

**For end users (open source)**: A single `docker-compose.yml` that runs everything — the dindang app container and Postgres. Users don't need Node, npm, or to clone the repo. Just:

```bash
curl -O https://raw.githubusercontent.com/.../docker-compose.yml
docker compose up
```

The compose file includes:
- `dindang` service: pre-built Docker image from a `Dockerfile` (Node app, production build)
- `postgres` service: standalone Postgres on port 5433, named volume for persistence
- The dindang container connects to Postgres via Docker networking (not localhost)
- Runs `drizzle-kit push` on startup to ensure schema is applied
- Auto-generates `DINDANG_ENCRYPTION_SECRET` if not set (via entrypoint script)

**For developers**: Clone the repo, `docker compose up postgres` (just the DB), then `npm run dev` as usual.

This requires:
- A `Dockerfile` for the dindang app (multi-stage: build + runtime)
- A `docker-compose.yml` with both services
- An entrypoint script that handles first-run setup (migrations, secret generation)

### 9. Encryption Secret

`DINDANG_ENCRYPTION_SECRET` is required in both modes — credentials (GitHub PAT, SSH keys) are encrypted at rest. Auto-generate a random secret on first run if not set, and write it to `.env`. This minimizes required config for the "clone and run" experience.

Note: if a user changes `DINDANG_ENCRYPTION_SECRET`, all previously stored credentials become permanently unrecoverable. This is true in both modes.

### 10. Supabase Client in `src/db/index.ts`

The `supabase` singleton export in `src/db/index.ts` is used only for auth (which is now handled by the adapter in `auth.ts`). Remove this export. No server files import it. The `db` (Drizzle) export is unaffected.

### 11. Drizzle Migrations

No schema changes needed. The same Postgres schema works for both modes. Migrations run the same way (`drizzle-kit push` or `drizzle-kit migrate`).

### 12. `.env.example`

Update to show local-mode-friendly defaults:

```
# Mode: "local" (default) or "hosted"
# DINDANG_MODE=local

# Required for both modes
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/dindang

# Auto-generated on first run if not set
# DINDANG_ENCRYPTION_SECRET=

# Only needed for hosted mode
# SUPABASE_URL=
# SUPABASE_ANON_KEY=
# VITE_SUPABASE_URL=
# VITE_SUPABASE_ANON_KEY=

# Callback URL for agent hooks
DINDANG_CALLBACK_URL=http://localhost:3000
```

## Limitations

- **No local-to-hosted migration**: Encrypted credentials use `deriveKey(userId)`. The fixed local userId produces different derived keys than a real Supabase user ID, so credentials stored in local mode cannot be decrypted after switching to hosted mode. This is an accepted limitation.
- **No multi-user in local mode**: Single user, single org. Teams are a hosted-only feature.

## Files Changed

| File | Change |
|------|--------|
| `src/server/auth.ts` | Mode-based auth: local returns fixed IDs, hosted uses Supabase (dynamic import) |
| `src/lib/supabase-client.ts` | New — browser-side Supabase facade, returns `null` in local mode |
| `src/server/seed.ts` | New — idempotent local user/org seeding (2 inserts: org + orgMember) |
| `src/server/lifecycle.ts` | Call seed before reconciliation in local mode |
| `src/routes/__root.tsx` | Use facade, skip auth checks in local mode, hide sign-out/email |
| `src/routes/login.tsx` | Use facade, redirect to `/` in local mode |
| `src/routes/auth.callback.tsx` | Use facade, redirect to `/` in local mode |
| `src/routes/settings.tsx` | Conditional credentials UI (PAT vs OAuth), hide team tab, skip `listMembers()` in local |
| `src/db/index.ts` | Remove `supabase` singleton export |
| `Dockerfile` | New — multi-stage build for production dindang image |
| `docker-compose.yml` | New — dindang app + Postgres for local mode |
| `docker-entrypoint.sh` | New — first-run setup: migrations, secret generation |
| `.env.example` | Update with local-mode-friendly defaults and comments |
| `vite.config.ts` | Expose `VITE_DINDANG_MODE` to client |

## What Stays the Same

- All server functions (`agents.ts`, `settings.ts`, `machine-registry.ts`)
- Database schema
- Transport/Runtime abstractions
- Terminal WebSocket bridge
- Preview proxy
- Agent setup
- Encryption logic

## Testing

- Local mode: `npm run dev` with only `DATABASE_URL` set — app loads directly to dashboard, no login
- Hosted mode: all existing flows unchanged (set `DINDANG_MODE=hosted` + Supabase env vars)
- Seeding: idempotent — running seed multiple times is safe
- Credentials: PAT save/load works in local mode
- Agent creation: works with local user's PAT
- Settings page: team tab hidden in local, visible in hosted
