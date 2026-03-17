# Local Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `local` mode so dindang works without Supabase — single user, auto-created org, standalone Postgres via Docker Compose.

**Architecture:** Mode-based auth adapter (`DINDANG_MODE=local|hosted`). Local mode returns fixed user/org IDs, skips Supabase entirely. A browser-side facade (`supabase-client.ts`) conditionally loads Supabase only in hosted mode. Docker Compose bundles the app + Postgres for end users.

**Tech Stack:** Existing stack unchanged. Adds `Dockerfile`, `docker-compose.yml`, `docker-entrypoint.sh`.

---

## Chunk 1: Mode detection + auth adapter + seeding

### Task 1: Add mode helper and vite config

**Files:**
- Create: `src/lib/mode.ts`
- Modify: `vite.config.ts:61-78`

- [ ] **Step 1: Create mode helper**

Create `src/lib/mode.ts`:

```typescript
export type DindangMode = "local" | "hosted";

export function getMode(): DindangMode {
  const mode = process.env.DINDANG_MODE || "local";
  if (mode !== "local" && mode !== "hosted") {
    throw new Error(`Invalid DINDANG_MODE: ${mode}. Must be "local" or "hosted".`);
  }
  return mode;
}

export function isLocalMode(): boolean {
  return getMode() === "local";
}
```

- [ ] **Step 2: Expose mode to client in vite.config.ts**

In `vite.config.ts`, inside the `define` block (line 66), add:

```typescript
"import.meta.env.VITE_DINDANG_MODE": JSON.stringify(env.DINDANG_MODE || "local"),
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/mode.ts vite.config.ts
git commit -m "feat: add DINDANG_MODE detection and expose to client"
```

---

### Task 2: Rewrite auth.ts with mode-based adapter

**Files:**
- Modify: `src/server/auth.ts` (full rewrite)

- [ ] **Step 1: Write tests for local mode auth**

Create `src/server/__tests__/auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Must set env before importing
vi.stubEnv("DINDANG_MODE", "local");

describe("auth - local mode", () => {
  it("requireAuth returns fixed local user ID", async () => {
    const { requireAuth } = await import("~/server/auth");
    const userId = await requireAuth();
    expect(userId).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("requireAuthWithOrg returns fixed user and org IDs", async () => {
    const { requireAuthWithOrg } = await import("~/server/auth");
    const { userId, orgId } = await requireAuthWithOrg();
    expect(userId).toBe("00000000-0000-0000-0000-000000000000");
    expect(orgId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("requireRole always passes in local mode", async () => {
    const { requireRole } = await import("~/server/auth");
    const result = await requireRole("any", "any", "owner");
    expect(result).toEqual({ role: "owner" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/server/__tests__/auth.test.ts`
Expected: FAIL (current auth.ts imports Supabase at top level)

- [ ] **Step 3: Rewrite auth.ts**

Replace `src/server/auth.ts` with:

```typescript
import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { orgMembers, orgs } from "~/db/schema";
import { isLocalMode } from "~/lib/mode";

const LOCAL_USER_ID = "00000000-0000-0000-0000-000000000000";
const LOCAL_ORG_ID = "00000000-0000-0000-0000-000000000001";

export async function requireAuth(): Promise<string> {
  if (isLocalMode()) return LOCAL_USER_ID;

  const { createServerClient } = await import("@supabase/ssr");
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const supabase = createSupabaseServerClient(createServerClient, request);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return user.id;
}

export async function getActiveOrgId(userId: string): Promise<string> {
  if (isLocalMode()) return LOCAL_ORG_ID;

  const membership = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId))
    .limit(1);
  if (membership.length === 0) throw new Error("User has no org");
  return membership[0]!.orgId;
}

export async function requireRole(
  userId: string,
  orgId: string,
  minimumRole: "owner" | "admin" | "member",
): Promise<{ role: string }> {
  if (isLocalMode()) return { role: minimumRole };

  const membership = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)))
    .limit(1);
  if (membership.length === 0) throw new Error("Not a member of this org");
  const role = membership[0]!.role;
  const hierarchy = { owner: 3, admin: 2, member: 1 };
  if (hierarchy[role as keyof typeof hierarchy] < hierarchy[minimumRole]) {
    throw new Error(`Requires ${minimumRole} role`);
  }
  return { role };
}

export async function createOrgForUser(userId: string, displayName: string): Promise<string> {
  const org = await db
    .insert(orgs)
    .values({ name: `${displayName}'s Workspace` })
    .returning({ id: orgs.id });
  const orgId = org[0]!.id;
  await db.insert(orgMembers).values({ orgId, userId, role: "owner" });
  return orgId;
}

export async function ensureOrg(userId: string): Promise<string> {
  if (isLocalMode()) return LOCAL_ORG_ID;

  const membership = await db
    .select({ orgId: orgMembers.orgId })
    .from(orgMembers)
    .where(eq(orgMembers.userId, userId))
    .limit(1);
  if (membership.length > 0) return membership[0]!.orgId;

  const { createServerClient } = await import("@supabase/ssr");
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  const supabase = createSupabaseServerClient(createServerClient, request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const displayName = user?.user_metadata?.full_name || user?.email || "My";
  return createOrgForUser(userId, displayName);
}

export async function requireAuthWithOrg(): Promise<{ userId: string; orgId: string }> {
  if (isLocalMode()) return { userId: LOCAL_USER_ID, orgId: LOCAL_ORG_ID };

  const userId = await requireAuth();
  const orgId = await ensureOrg(userId);
  return { userId, orgId };
}

// Exported for use by other hosted-mode code
export { LOCAL_USER_ID, LOCAL_ORG_ID };

// Helper to create Supabase server client (hosted mode only)
function createSupabaseServerClient(createServerClient: any, request: Request) {
  const cookies = parseCookies(request.headers.get("cookie") ?? "");
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookies,
        setAll: () => {},
      },
    },
  );
}

function parseCookies(cookieHeader: string): { name: string; value: string }[] {
  if (!cookieHeader) return [];
  return cookieHeader.split(";").map((c) => {
    const [name, ...rest] = c.trim().split("=");
    return { name: name!, value: rest.join("=") };
  });
}
```

Key changes:
- No top-level Supabase imports — dynamic `await import()` inside hosted-only paths
- Local mode short-circuits with fixed IDs in `requireAuth`, `requireAuthWithOrg`, `ensureOrg`, `requireRole`, `getActiveOrgId`
- `createSupabaseServerClient` receives `createServerClient` as a parameter (from dynamic import)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/server/__tests__/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `npm test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/server/auth.ts src/server/__tests__/auth.test.ts
git commit -m "feat: mode-based auth adapter with local mode support"
```

---

### Task 3: DB seeding for local mode

**Files:**
- Create: `src/server/seed.ts`
- Modify: `src/server/lifecycle.ts:10` (call seed before reconciliation)

- [ ] **Step 1: Write seed test**

Create `src/server/__tests__/seed.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("DINDANG_MODE", "local");

// Mock the db module
vi.mock("~/db", () => {
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  };
  return { db: mockDb };
});

describe("seedLocalUser", () => {
  it("inserts org and orgMember when DB is empty", async () => {
    const { seedLocalUser } = await import("~/server/seed");
    await seedLocalUser();
    const { db } = await import("~/db");
    expect(db.insert).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/server/__tests__/seed.test.ts`
Expected: FAIL (`seed.ts` doesn't exist)

- [ ] **Step 3: Create seed.ts**

Create `src/server/seed.ts`:

```typescript
import { db } from "~/db";
import { orgs, orgMembers } from "~/db/schema";

const LOCAL_USER_ID = "00000000-0000-0000-0000-000000000000";
const LOCAL_ORG_ID = "00000000-0000-0000-0000-000000000001";

export async function seedLocalUser(): Promise<void> {
  await db
    .insert(orgs)
    .values({ id: LOCAL_ORG_ID, name: "Local" })
    .onConflictDoNothing();

  await db
    .insert(orgMembers)
    .values({
      orgId: LOCAL_ORG_ID,
      userId: LOCAL_USER_ID,
      role: "owner",
    })
    .onConflictDoNothing();

  console.log("[seed] local user and org ready");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/server/__tests__/seed.test.ts`
Expected: PASS

- [ ] **Step 5: Update lifecycle.ts to call seed before reconciliation**

In `src/server/lifecycle.ts`, add import and seed call at the top of `reconcileOnStartup()`:

```typescript
import { isLocalMode } from "~/lib/mode";
import { seedLocalUser } from "~/server/seed";

export async function reconcileOnStartup(): Promise<void> {
  try {
    if (isLocalMode()) {
      await seedLocalUser();
    }
    // ... rest of existing reconciliation code unchanged
```

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/server/seed.ts src/server/__tests__/seed.test.ts src/server/lifecycle.ts
git commit -m "feat: seed local user and org on startup"
```

---

### Task 4: Remove Supabase singleton from db/index.ts

**Files:**
- Modify: `src/db/index.ts`

- [ ] **Step 1: Verify no code imports supabase from ~/db**

Run: `grep -r "from.*~/db" src/ --include="*.ts" --include="*.tsx" | grep supabase`
Expected: No results (only `db` is imported from `~/db`)

- [ ] **Step 2: Remove Supabase exports from db/index.ts**

Replace `src/db/index.ts` with:

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let _db: PostgresJsDatabase<typeof schema> | undefined;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    _db = drizzle(postgres(url), { schema });
  }
  return _db;
}

// Convenience re-export for existing call sites
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_, prop) {
    return (getDb() as any)[prop];
  },
});
```

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/db/index.ts
git commit -m "refactor: remove Supabase singleton from db/index.ts"
```

---

## Chunk 2: Frontend — Supabase facade + route updates

### Task 5: Create Supabase browser client facade

**Files:**
- Create: `src/lib/supabase-client.ts`

- [ ] **Step 1: Create the facade**

Create `src/lib/supabase-client.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (import.meta.env.VITE_DINDANG_MODE === "local") return null;

  if (_client !== undefined) return _client;

  // Lazy-load Supabase only in hosted mode
  // This is synchronous because createBrowserClient is loaded eagerly in hosted mode
  // We use a sync check here and initialize in initSupabase()
  return _client ?? null;
}

let _initPromise: Promise<SupabaseClient | null> | undefined;

export async function initSupabase(): Promise<SupabaseClient | null> {
  if (import.meta.env.VITE_DINDANG_MODE === "local") return null;

  if (!_initPromise) {
    _initPromise = (async () => {
      const { createBrowserClient } = await import("@supabase/ssr");
      _client = createBrowserClient(
        import.meta.env.VITE_SUPABASE_URL!,
        import.meta.env.VITE_SUPABASE_ANON_KEY!,
      );
      return _client;
    })();
  }

  return _initPromise;
}

export function isLocalMode(): boolean {
  return import.meta.env.VITE_DINDANG_MODE === "local";
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/supabase-client.ts
git commit -m "feat: Supabase browser client facade for conditional loading"
```

---

### Task 6: Update __root.tsx to use facade

**Files:**
- Modify: `src/routes/__root.tsx`

- [ ] **Step 1: Rewrite __root.tsx**

Replace `src/routes/__root.tsx` with the mode-aware version. Key changes:
- Remove static `import { createBrowserClient } from "@supabase/ssr"`
- Import `initSupabase`, `isLocalMode` from `~/lib/supabase-client`
- In local mode: no Supabase init, no auth state, always render app, hide sign-out/email
- In hosted mode: init Supabase in useEffect, current auth flow unchanged

```typescript
import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useNavigate,
  useLocation,
} from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { initSupabase, isLocalMode } from "~/lib/supabase-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootError,
  head: () => ({
    links: [{ rel: "stylesheet", href: appCss }],
  }),
});

function RootError({ error }: { error: Error }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>dindang - error</title>
        <HeadContent />
      </head>
      <body className="bg-zinc-950 text-zinc-100 font-mono min-h-screen flex items-center justify-center" suppressHydrationWarning>
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-bold text-red-400">Something went wrong</h1>
          <p className="text-sm text-zinc-400">{error.message}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors cursor-pointer"
            >
              retry
            </button>
            <a
              href="/login"
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors"
            >
              back to login
            </a>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  const [user, setUser] = useState<any>(isLocalMode() ? {} : null);
  const [loading, setLoading] = useState(!isLocalMode());
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isLocalMode()) return;

    initSupabase().then((client) => {
      if (!client) return;
      setSupabase(client);

      client.auth.getSession().then(({ data: { session } }) => {
        setUser(session?.user ?? null);
        setLoading(false);
      });
      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
      });
      return () => subscription.unsubscribe();
    });
  }, []);

  const isPublicRoute =
    location.pathname === "/login" || location.pathname === "/auth/callback";

  useEffect(() => {
    if (!loading && !user && !isPublicRoute) {
      navigate({ to: "/login" });
    }
  }, [loading, user, isPublicRoute, navigate]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>dindang</title>
        <HeadContent />
      </head>
      <body className="bg-zinc-950 text-zinc-100 font-mono min-h-screen" suppressHydrationWarning>
        {!loading && (
          <>
            <nav className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
              <Link to="/" className="text-sm font-bold hover:text-zinc-300">
                dindang
              </Link>
              {user && (
                <div className="flex items-center gap-3">
                  <Link
                    to="/settings"
                    className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    settings
                  </Link>
                  {!isLocalMode() && (
                    <>
                      <span className="text-xs text-zinc-500">{user.email}</span>
                      <button
                        onClick={() => supabase?.auth.signOut()}
                        className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
                      >
                        sign out
                      </button>
                    </>
                  )}
                </div>
              )}
            </nav>
            <Outlet />
          </>
        )}
        <Scripts />
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/__root.tsx
git commit -m "feat: mode-aware root layout — skip auth in local mode"
```

---

### Task 7: Update login.tsx and auth.callback.tsx

**Files:**
- Modify: `src/routes/login.tsx`
- Modify: `src/routes/auth.callback.tsx`

- [ ] **Step 1: Rewrite login.tsx**

Replace `src/routes/login.tsx`:

```typescript
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { initSupabase, isLocalMode } from "~/lib/supabase-client";
import { toErrorMessage } from "~/lib/errors";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();

  // In local mode, redirect to home immediately
  useEffect(() => {
    if (isLocalMode()) navigate({ to: "/" });
  }, [navigate]);

  if (isLocalMode()) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-zinc-400">Redirecting...</p>
      </div>
    );
  }

  return <HostedLoginForm />;
}

function HostedLoginForm() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWithOAuth = async (provider: "github" | "google") => {
    const supabase = await initSupabase();
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: provider === "github" ? "repo" : undefined,
      },
    });
  };

  const signInWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = await initSupabase();
      if (!supabase) return;
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        if (authError.message === "Invalid login credentials") {
          const { error: signUpError } = await supabase.auth.signUp({ email, password });
          if (signUpError) throw signUpError;
        } else {
          throw authError;
        }
      }
      navigate({ to: "/" });
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center mb-8">dindang</h1>

        <form onSubmit={signInWithPassword} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full px-4 py-3 bg-white text-black hover:bg-zinc-200 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            {loading ? "..." : "Sign in / Sign up"}
          </button>
        </form>

        {error && <p className="text-red-400 text-xs text-center">{error}</p>}

        <div className="flex items-center gap-3 text-zinc-600 text-xs">
          <div className="flex-1 border-t border-zinc-800" />
          or
          <div className="flex-1 border-t border-zinc-800" />
        </div>

        <button
          onClick={() => signInWithOAuth("github")}
          className="w-full px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors cursor-pointer"
        >
          Sign in with GitHub
        </button>
        <button
          onClick={() => signInWithOAuth("google")}
          className="w-full px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors cursor-pointer"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite auth.callback.tsx**

Replace `src/routes/auth.callback.tsx`:

```typescript
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { initSupabase, isLocalMode } from "~/lib/supabase-client";
import { saveProviderToken } from "~/server/settings";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    if (isLocalMode()) {
      navigate({ to: "/" });
      return;
    }

    initSupabase().then((supabase) => {
      if (!supabase) return;

      supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === "SIGNED_IN") {
          if (session?.provider_token) {
            try {
              await saveProviderToken({
                data: { provider: "github", token: session.provider_token },
              });
            } catch {
              // Non-fatal — user can reconnect later from settings
            }
          }
          navigate({ to: "/" });
        }
      });
    });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-zinc-400">Signing in...</p>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/login.tsx src/routes/auth.callback.tsx
git commit -m "feat: mode-aware login and auth callback routes"
```

---

### Task 8: Update settings.tsx — credentials tab + team tab

**Files:**
- Modify: `src/routes/settings.tsx`

- [ ] **Step 1: Update settings loader to skip listMembers in local mode**

In `src/routes/settings.tsx`, update the Route loader (lines 24-35):

```typescript
import { isLocalMode } from "~/lib/supabase-client";

export const Route = createFileRoute("/settings")({
  loader: async () => {
    const [settings, machines, credStatus, members] = await Promise.all([
      loadSettings(),
      listMachinesApi(),
      getCredentialStatus(),
      isLocalMode() ? Promise.resolve([]) : listMembers(),
    ]);
    return { settings, machines, credStatus, members };
  },
  component: SettingsPage,
});
```

- [ ] **Step 2: Filter team tab in local mode**

In `SettingsPage` function, update the tabs array and conditionally hide team:

```typescript
function SettingsPage() {
  const { settings, machines, credStatus, members } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("projects");

  const tabs: { key: Tab; label: string }[] = [
    { key: "projects", label: "Projects" },
    { key: "machines", label: "Machines" },
    { key: "credentials", label: "Credentials" },
    ...(!isLocalMode() ? [{ key: "team" as Tab, label: "Team" }] : []),
  ];
```

- [ ] **Step 3: Update CredentialsTab — PAT input for local, OAuth for hosted**

Replace the `CredentialsTab` function to support both modes. Add `saveCredential` back to imports:

```typescript
import {
  // ... existing imports
  saveCredential,
  // ...
} from "~/server/settings";
```

Then replace the `CredentialsTab` function:

```typescript
function CredentialsTab({
  credStatus,
  router,
}: {
  credStatus: { hasGithub: boolean; hasAnthropic: boolean };
  router: ReturnType<typeof useRouter>;
}) {
  const [githubToken, setGithubToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const handleSaveToken = async () => {
    if (!githubToken.trim()) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveCredential({ data: { provider: "github", token: githubToken.trim() } });
      setGithubToken("");
      setSaved(true);
      await router.invalidate();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const connectGithub = async () => {
    setConnecting(true);
    setError(null);
    try {
      const { initSupabase } = await import("~/lib/supabase-client");
      const supabase = await initSupabase();
      if (!supabase) return;
      await supabase.auth.linkIdentity({
        provider: "github",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: "repo",
        },
      });
    } catch (e) {
      setError(toErrorMessage(e));
      setConnecting(false);
    }
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-4">
        Credentials
      </h2>
      <div className="space-y-4">
        {error && (
          <p className="text-red-400 text-xs">Error: {error}</p>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <label className="block text-xs text-zinc-500 mb-1">
            GitHub
          </label>
          {isLocalMode() ? (
            /* Local mode: PAT text input */
            <div>
              <p className="text-xs text-zinc-600 mb-2">
                Personal access token for private repo access.
                {credStatus.hasGithub && (
                  <span className="text-green-500 ml-2">configured</span>
                )}
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  placeholder={credStatus.hasGithub ? "Enter new token to replace" : "ghp_..."}
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
                />
                <button
                  onClick={handleSaveToken}
                  disabled={!githubToken.trim() || saving}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
                >
                  {saving ? "saving..." : "save"}
                </button>
              </div>
              {saved && (
                <span className="text-xs text-green-400 mt-1 inline-block">Saved</span>
              )}
            </div>
          ) : credStatus.hasGithub ? (
            /* Hosted mode: connected */
            <div className="flex items-center justify-between">
              <span className="text-sm text-green-400">Connected via GitHub</span>
              <button
                onClick={connectGithub}
                disabled={connecting}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
              >
                {connecting ? "connecting..." : "reconnect"}
              </button>
            </div>
          ) : (
            /* Hosted mode: not connected */
            <div>
              <p className="text-xs text-zinc-600 mb-3">
                Connect your GitHub account to let agents access your repositories.
              </p>
              <button
                onClick={connectGithub}
                disabled={connecting}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
              >
                {connecting ? "connecting..." : "Connect GitHub"}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/settings.tsx
git commit -m "feat: mode-aware settings — PAT input for local, OAuth for hosted, hide team tab"
```

---

## Chunk 3: Docker distribution + env config

### Task 9: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace .env.example**

```
# Mode: "local" (default) or "hosted"
# DINDANG_MODE=local

# Required for both modes
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/dindang

# Auto-generated on first run if not set
# DINDANG_ENCRYPTION_SECRET=

# Only needed for hosted mode (Supabase)
# SUPABASE_URL=
# SUPABASE_ANON_KEY=
# VITE_SUPABASE_URL=
# VITE_SUPABASE_ANON_KEY=

# Callback URL for agent hooks
DINDANG_CALLBACK_URL=http://localhost:3000
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: update .env.example with local-mode-friendly defaults"
```

---

### Task 10: Create Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

Create `.dockerignore`:

```
node_modules
.output
.env
.git
supabase
docs
*.md
```

- [ ] **Step 2: Create Dockerfile**

Create `Dockerfile`:

```dockerfile
# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime stage
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/.output .output
COPY --from=builder /app/src/db ./src/db
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add Dockerfile for production dindang image"
```

---

### Task 11: Create docker-entrypoint.sh

**Files:**
- Create: `docker-entrypoint.sh`

- [ ] **Step 1: Create entrypoint script**

Create `docker-entrypoint.sh`:

```bash
#!/bin/sh
set -e

# Auto-generate encryption secret if not set
if [ -z "$DINDANG_ENCRYPTION_SECRET" ]; then
  export DINDANG_ENCRYPTION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "[entrypoint] generated DINDANG_ENCRYPTION_SECRET"
fi

# Run database migrations
echo "[entrypoint] applying database schema..."
npx drizzle-kit push --force

echo "[entrypoint] starting dindang..."
exec node .output/server/index.mjs
```

- [ ] **Step 2: Commit**

```bash
git add docker-entrypoint.sh
git commit -m "feat: docker entrypoint with auto-secret and migrations"
```

---

### Task 12: Create docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: dindang
    ports:
      - "5433:5432"
    volumes:
      - dindang-data:/var/lib/postgresql/data

  dindang:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/dindang
      DINDANG_MODE: local
      DINDANG_CALLBACK_URL: http://host.docker.internal:3000
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      - postgres

volumes:
  dindang-data:
```

Note: The dindang container mounts the Docker socket so it can create agent containers. `DATABASE_URL` uses the Docker network hostname `postgres` (not localhost).

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: docker-compose with app + postgres for local mode"
```

---

### Task 13: Auto-generate encryption secret for dev mode

**Files:**
- Modify: `src/lib/crypto.ts:11-15`

- [ ] **Step 1: Update getSecret to auto-generate in local mode**

Update the `getSecret()` function in `src/lib/crypto.ts` to auto-generate a secret when running in local mode without one set:

```typescript
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "crypto";

// ... constants unchanged ...

let _generatedSecret: string | undefined;

function getSecret(): string {
  const secret = process.env.DINDANG_ENCRYPTION_SECRET;
  if (secret) return secret;

  // In local mode, auto-generate a persistent secret
  const mode = process.env.DINDANG_MODE || "local";
  if (mode === "local") {
    if (!_generatedSecret) {
      _generatedSecret = randomBytes(32).toString("hex");
      console.warn("[crypto] no DINDANG_ENCRYPTION_SECRET set — generated ephemeral secret. Credentials will not persist across restarts. Set DINDANG_ENCRYPTION_SECRET in .env for persistence.");
    }
    return _generatedSecret;
  }

  throw new Error("DINDANG_ENCRYPTION_SECRET environment variable is required");
}
```

This means local dev users who forget to set the secret still get a working app (with a warning), while hosted mode still requires it.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/lib/crypto.ts
git commit -m "feat: auto-generate ephemeral encryption secret in local mode"
```

---

### Task 14: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All pass

- [ ] **Step 2: Verify build succeeds**

Run: `npm run build`
Expected: Build completes without errors

- [ ] **Step 3: Final commit (if any remaining changes)**

```bash
git status
# If any uncommitted changes, commit them
```
