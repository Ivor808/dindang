# Runtime Adapter & Orchestration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add settings persistence, project configuration, Claude Code runtime adapter, and updated agent creation flow so users can one-click deploy Claude Code agents against their configured projects.

**Architecture:** Settings stored in `~/.dindang/config.json`. New `/settings` route for credentials + project management. Docker provider updated to use `node:22-slim` base image, clone repos, run setup commands, install Claude Code, and inject HTTP hooks. Agent creation updated with project dropdown.

**Tech Stack:** TanStack Start (server functions), React, Tailwind CSS v4, dockerode, Node.js `crypto` for API key encryption.

---

## File Structure

```
src/
├── lib/
│   ├── types.ts              — MODIFY: Add Project, Settings types, update AgentStatus
│   ├── provider.ts            — MODIFY: Update DeploymentProvider.create() signature
│   ├── config.ts              — CREATE: Settings store (read/write ~/.dindang/config.json)
│   ├── crypto.ts              — CREATE: Encrypt/decrypt API keys
│   └── names.ts               — NO CHANGE
├── server/
│   ├── settings.ts            — CREATE: Server functions for settings/project CRUD
│   ├── agents.ts              — MODIFY: Accept projectId on create, pass to provider
│   └── docker-provider.ts     — MODIFY: New base image, repo clone, Claude Code setup, hooks
├── routes/
│   ├── __root.tsx             — MODIFY: Add nav link to /settings
│   ├── index.tsx              — MODIFY: Agent creation with project dropdown
│   ├── agent.$name.tsx        — MODIFY: Show project name, use claude -p for commands
│   └── settings.tsx           — CREATE: Settings page (credentials + projects)
├── components/
│   ├── agent-card.tsx         — MODIFY: Show project name on card
│   └── status-badge.tsx       — MODIFY: Update status color map for new statuses
├── router.tsx                 — NO CHANGE
└── styles.css                 — NO CHANGE
```

---

## Chunk 1: Data Model & Settings Store

### Task 1: Update Types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Update the types file with new data model**

Replace entire contents of `src/lib/types.ts`:

```typescript
export type AgentStatus = "provisioning" | "ready" | "busy" | "error";

export interface Agent {
  id: string;
  name: string;
  projectId: string;
  machineId: string;
  containerId: string;
  status: AgentStatus;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  repoUrl: string;
  setupCommand?: string;
  isDefault: boolean;
}

export interface Settings {
  anthropicApiKey: string;
  githubToken: string;
  projects: Project[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/runa/dindang && npx tsc --noEmit 2>&1 | head -30`
Expected: Type errors in files that depend on the old Agent shape (agent-card, status-badge, docker-provider, agents.ts, routes). This is expected — we'll fix them in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: update data model with Project, Settings types and new AgentStatus"
```

---

### Task 2: Create Crypto Utility

**Files:**
- Create: `src/lib/crypto.ts`

- [ ] **Step 1: Create the encryption utility**

Create `src/lib/crypto.ts`:

```typescript
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 16;
const SALT_LEN = 16;
const TAG_LEN = 16;

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN);
}

function getMachineId(): string {
  // Use hostname + homedir as a stable machine-specific seed
  const os = require("os");
  return `${os.hostname()}-${os.homedir()}`;
}

export function encrypt(plaintext: string): string {
  const salt = randomBytes(SALT_LEN);
  const key = deriveKey(getMachineId(), salt);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: salt:iv:tag:ciphertext (all hex)
  return [salt, iv, tag, encrypted].map((b) => b.toString("hex")).join(":");
}

export function decrypt(encoded: string): string {
  const [saltHex, ivHex, tagHex, dataHex] = encoded.split(":");
  if (!saltHex || !ivHex || !tagHex || !dataHex) throw new Error("Invalid encrypted format");
  const salt = Buffer.from(saltHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const key = deriveKey(getMachineId(), salt);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final("utf8");
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/runa/dindang && npx tsc --noEmit src/lib/crypto.ts 2>&1 | head -10`
Expected: No errors in this file specifically.

- [ ] **Step 3: Commit**

```bash
git add src/lib/crypto.ts
git commit -m "feat: add crypto utility for API key encryption"
```

---

### Task 3: Create Config Store

**Files:**
- Create: `src/lib/config.ts`

- [ ] **Step 1: Create the config store**

Create `src/lib/config.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { encrypt, decrypt } from "./crypto";
import type { Settings, Project } from "./types";

const CONFIG_DIR = join(homedir(), ".dindang");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface ConfigFile {
  anthropicApiKey?: string; // encrypted
  githubToken?: string; // encrypted
  projects: Project[];
}

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readConfig(): ConfigFile {
  ensureDir();
  if (!existsSync(CONFIG_FILE)) {
    return { projects: [] };
  }
  const raw = readFileSync(CONFIG_FILE, "utf8");
  return JSON.parse(raw) as ConfigFile;
}

function writeConfig(config: ConfigFile): void {
  ensureDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

export function getSettings(): Settings {
  const config = readConfig();
  return {
    anthropicApiKey: config.anthropicApiKey ? decrypt(config.anthropicApiKey) : "",
    githubToken: config.githubToken ? decrypt(config.githubToken) : "",
    projects: config.projects,
  };
}

export function saveCredentials(anthropicApiKey: string, githubToken: string): void {
  const config = readConfig();
  // Only overwrite if a new value is provided — don't wipe existing keys
  if (anthropicApiKey) config.anthropicApiKey = encrypt(anthropicApiKey);
  if (githubToken) config.githubToken = encrypt(githubToken);
  writeConfig(config);
}

export function getProjects(): Project[] {
  return readConfig().projects;
}

export function addProject(project: Omit<Project, "id">): Project {
  const config = readConfig();
  const newProject: Project = { ...project, id: randomBytes(8).toString("hex") };
  // If this is marked default, unmark others
  if (newProject.isDefault) {
    config.projects.forEach((p) => (p.isDefault = false));
  }
  // If this is the first project, make it default
  if (config.projects.length === 0) {
    newProject.isDefault = true;
  }
  config.projects.push(newProject);
  writeConfig(config);
  return newProject;
}

export function updateProject(id: string, updates: Partial<Omit<Project, "id">>): Project {
  const config = readConfig();
  const idx = config.projects.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Project ${id} not found`);
  if (updates.isDefault) {
    config.projects.forEach((p) => (p.isDefault = false));
  }
  config.projects[idx] = { ...config.projects[idx]!, ...updates };
  writeConfig(config);
  return config.projects[idx]!;
}

export function removeProject(id: string): void {
  const config = readConfig();
  const idx = config.projects.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Project ${id} not found`);
  const wasDefault = config.projects[idx]!.isDefault;
  config.projects.splice(idx, 1);
  // If we removed the default, make the first remaining project default
  if (wasDefault && config.projects.length > 0) {
    config.projects[0]!.isDefault = true;
  }
  writeConfig(config);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/runa/dindang && npx tsc --noEmit src/lib/config.ts 2>&1 | head -10`

- [ ] **Step 3: Commit**

```bash
git add src/lib/config.ts
git commit -m "feat: add config store for settings persistence in ~/.dindang/config.json"
```

---

### Task 4: Create Settings Server Functions

**Files:**
- Create: `src/server/settings.ts`

- [ ] **Step 1: Create server functions for settings CRUD**

Create `src/server/settings.ts`:

```typescript
import { createServerFn } from "@tanstack/react-start";
import {
  getSettings,
  saveCredentials,
  getProjects,
  addProject,
  updateProject,
  removeProject,
} from "~/lib/config";
import type { Project } from "~/lib/types";

export const loadSettings = createServerFn({ method: "GET" }).handler(async () => {
  const settings = getSettings();
  // Mask API keys for the frontend — only show last 4 chars
  return {
    anthropicApiKey: settings.anthropicApiKey
      ? `${"•".repeat(Math.max(0, settings.anthropicApiKey.length - 4))}${settings.anthropicApiKey.slice(-4)}`
      : "",
    githubToken: settings.githubToken
      ? `${"•".repeat(Math.max(0, settings.githubToken.length - 4))}${settings.githubToken.slice(-4)}`
      : "",
    hasAnthropicKey: settings.anthropicApiKey.length > 0,
    hasGithubToken: settings.githubToken.length > 0,
    projects: settings.projects,
  };
});

export const saveKeys = createServerFn({ method: "POST" })
  .inputValidator((data: { anthropicApiKey: string; githubToken: string }) => data)
  .handler(async ({ data }) => {
    saveCredentials(data.anthropicApiKey, data.githubToken);
    return { ok: true };
  });

export const listProjects = createServerFn({ method: "GET" }).handler(async () => {
  return getProjects();
});

export const createProject = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { name: string; repoUrl: string; setupCommand?: string; isDefault: boolean }) => data
  )
  .handler(async ({ data }) => {
    return addProject(data);
  });

export const editProject = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; name?: string; repoUrl?: string; setupCommand?: string; isDefault?: boolean }) => data
  )
  .handler(async ({ data }) => {
    const { id, ...updates } = data;
    return updateProject(id, updates);
  });

export const deleteProject = createServerFn({ method: "POST" })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    removeProject(id);
    return { ok: true };
  });
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/runa/dindang && npx tsc --noEmit src/server/settings.ts 2>&1 | head -10`

- [ ] **Step 3: Commit**

```bash
git add src/server/settings.ts
git commit -m "feat: add server functions for settings and project CRUD"
```

---

## Chunk 2: Settings UI

### Task 5: Create Settings Page

**Files:**
- Create: `src/routes/settings.tsx`

- [ ] **Step 1: Create the settings route**

Create `src/routes/settings.tsx`:

```tsx
import { createFileRoute, useRouter, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  loadSettings,
  saveKeys,
  createProject,
  editProject,
  deleteProject,
} from "~/server/settings";
import type { Project } from "~/lib/types";

export const Route = createFileRoute("/settings")({
  loader: () => loadSettings(),
  component: SettingsPage,
});

function SettingsPage() {
  const settings = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  // Credentials state
  const [anthropicKey, setAnthropicKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);

  // Project form state
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [setupCmd, setSetupCmd] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  const handleSaveKeys = async () => {
    if (!anthropicKey && !githubToken) return;
    setSaving(true);
    setKeyMsg(null);
    try {
      await saveKeys({
        data: {
          anthropicApiKey: anthropicKey,
          githubToken: githubToken,
        },
      });
      setAnthropicKey("");
      setGithubToken("");
      setKeyMsg("Saved");
      await router.invalidate();
    } catch (e) {
      setKeyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleAddProject = async () => {
    if (!projectName.trim() || !repoUrl.trim()) return;
    setProjectError(null);
    try {
      await createProject({
        data: {
          name: projectName.trim(),
          repoUrl: repoUrl.trim(),
          setupCommand: setupCmd.trim() || undefined,
          isDefault,
        },
      });
      setProjectName("");
      setRepoUrl("");
      setSetupCmd("");
      setIsDefault(false);
      setShowProjectForm(false);
      await router.invalidate();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteProject({ data: id });
      await router.invalidate();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await editProject({ data: { id, isDefault: true } });
      await router.invalidate();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => navigate({ to: "/" })}
          className="text-zinc-500 hover:text-zinc-300 text-sm cursor-pointer"
        >
          &larr; back
        </button>
        <h1 className="text-xl font-bold">settings</h1>
      </div>

      {/* Credentials Section */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-4">
          Credentials
        </h2>
        <div className="space-y-4 bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">
              Anthropic API Key
              {settings.hasAnthropicKey && (
                <span className="text-green-500 ml-2">configured ({settings.anthropicApiKey})</span>
              )}
            </label>
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder={settings.hasAnthropicKey ? "Enter new key to replace" : "sk-ant-..."}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">
              GitHub Token
              {settings.hasGithubToken && (
                <span className="text-green-500 ml-2">configured ({settings.githubToken})</span>
              )}
            </label>
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder={settings.hasGithubToken ? "Enter new token to replace" : "ghp_..."}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveKeys}
              disabled={saving || (!anthropicKey && !githubToken)}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
            >
              {saving ? "saving..." : "save keys"}
            </button>
            {keyMsg && (
              <span className={`text-xs ${keyMsg === "Saved" ? "text-green-400" : "text-red-400"}`}>
                {keyMsg}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Projects Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide">
            Projects
          </h2>
          <button
            onClick={() => setShowProjectForm(!showProjectForm)}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors cursor-pointer"
          >
            {showProjectForm ? "cancel" : "+ add project"}
          </button>
        </div>

        {projectError && (
          <p className="text-red-400 text-xs mb-3">Error: {projectError}</p>
        )}

        {/* Add project form */}
        {showProjectForm && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4 space-y-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="backend-api"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Repo URL</label>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="github.com/org/repo"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Setup Command (optional)</label>
              <input
                type="text"
                value={setupCmd}
                onChange={(e) => setSetupCmd(e.target.value)}
                placeholder="npm install && npm run build"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isDefault"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="accent-zinc-500"
              />
              <label htmlFor="isDefault" className="text-xs text-zinc-400">
                Set as default project
              </label>
            </div>
            <button
              onClick={handleAddProject}
              disabled={!projectName.trim() || !repoUrl.trim()}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
            >
              add project
            </button>
          </div>
        )}

        {/* Project list */}
        {settings.projects.length === 0 ? (
          <p className="text-zinc-600 text-sm">No projects configured yet.</p>
        ) : (
          <div className="space-y-2">
            {settings.projects.map((project: Project) => (
              <div
                key={project.id}
                className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{project.name}</span>
                    {project.isDefault && (
                      <span className="text-xs bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded">
                        default
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">{project.repoUrl}</p>
                  {project.setupCommand && (
                    <p className="text-xs text-zinc-600 mt-0.5 font-mono">
                      $ {project.setupCommand}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {!project.isDefault && (
                    <button
                      onClick={() => handleSetDefault(project.id)}
                      className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    >
                      set default
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteProject(project.id)}
                    className="text-xs text-red-400 hover:text-red-300 cursor-pointer"
                  >
                    remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify the route generates**

Run: `cd /home/runa/dindang && npx vite dev --port 3000 &` then wait 3 seconds, then check `src/routeTree.gen.ts` includes the `/settings` route. Kill the dev server after.

- [ ] **Step 3: Commit**

```bash
git add src/routes/settings.tsx
git commit -m "feat: add settings page with credentials and project management"
```

---

### Task 6: Add Nav to Root Layout

**Files:**
- Modify: `src/routes/__root.tsx`

- [ ] **Step 1: Add a minimal nav bar with settings link**

In `src/routes/__root.tsx`, replace the `<body>` contents to add a nav:

```tsx
import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  component: RootLayout,
  head: () => ({
    links: [{ rel: "stylesheet", href: appCss }],
  }),
});

function RootLayout() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>dindang</title>
        <HeadContent />
      </head>
      <body className="bg-zinc-950 text-zinc-100 font-mono min-h-screen">
        <nav className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
          <Link to="/" className="text-sm font-bold hover:text-zinc-300">
            dindang
          </Link>
          <Link
            to="/settings"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            settings
          </Link>
        </nav>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verify page loads**

Open `http://localhost:3000` — should see "dindang" on the left and "settings" link on the right. Click settings → should show the settings page.

- [ ] **Step 3: Commit**

```bash
git add src/routes/__root.tsx
git commit -m "feat: add nav bar with settings link to root layout"
```

---

## Chunk 3: Update Agent Flow

### Task 7: Update Status Badge

**Files:**
- Modify: `src/components/status-badge.tsx`

- [ ] **Step 1: Update status colors for new statuses**

Replace entire contents of `src/components/status-badge.tsx`:

```tsx
import type { AgentStatus } from "~/lib/types";

const styles: Record<AgentStatus, string> = {
  provisioning: "bg-yellow-900 text-yellow-300",
  ready: "bg-green-900 text-green-300",
  busy: "bg-blue-900 text-blue-300",
  error: "bg-red-900 text-red-300",
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/status-badge.tsx
git commit -m "feat: update status badge for new agent statuses"
```

---

### Task 8: Update Agent Card

**Files:**
- Modify: `src/components/agent-card.tsx`

- [ ] **Step 1: Show project name on agent card**

Replace entire contents of `src/components/agent-card.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import type { Agent } from "~/lib/types";
import { StatusBadge } from "./status-badge";

export function AgentCard({ agent, projectName }: { agent: Agent; projectName?: string }) {
  return (
    <Link
      to="/agent/$name"
      params={{ name: agent.name }}
      className="block border border-zinc-800 rounded-lg p-4 hover:border-zinc-600 transition-colors bg-zinc-900"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium truncate">{agent.name}</span>
        <StatusBadge status={agent.status} />
      </div>
      {projectName && (
        <p className="text-xs text-zinc-500 truncate">{projectName}</p>
      )}
      <p className="text-xs text-zinc-600 mt-2">
        {new Date(agent.createdAt).toLocaleTimeString()}
      </p>
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agent-card.tsx
git commit -m "feat: show project name on agent card"
```

---

### Task 9: Update DeploymentProvider Interface

**Files:**
- Modify: `src/lib/provider.ts`

- [ ] **Step 1: Update create signature to accept project config**

Replace entire contents of `src/lib/provider.ts`:

```typescript
import type { Agent } from "./types";

export interface CreateAgentOptions {
  name: string;
  projectId: string;
  repoUrl: string;
  githubToken: string;
  anthropicApiKey: string;
  setupCommand?: string;
  dindangHost: string;
}

export interface DeploymentProvider {
  create(options: CreateAgentOptions): Promise<Agent>;
  exec(nameOrId: string, command: string): Promise<void>;
  stop(nameOrId: string): Promise<void>;
  remove(nameOrId: string): Promise<void>;
  getStatus(nameOrId: string): Promise<Agent>;
  getLogs(nameOrId: string): Promise<string>;
  list(): Promise<Agent[]>;
}
```

Note: `start` is renamed to `exec` to clarify it runs a command in an existing container, not starts the container.

- [ ] **Step 2: Commit**

```bash
git add src/lib/provider.ts
git commit -m "feat: update DeploymentProvider interface with CreateAgentOptions"
```

---

### Task 10: Update Docker Provider

**Files:**
- Modify: `src/server/docker-provider.ts`

This is the biggest change — the provider now creates containers with `node:22-slim`, clones repos, installs Claude Code, injects hooks, and runs setup commands.

- [ ] **Step 1: Rewrite docker-provider.ts**

Replace entire contents of `src/server/docker-provider.ts`:

```typescript
import Docker from "dockerode";
import type { DeploymentProvider, CreateAgentOptions } from "~/lib/provider";
import type { Agent, AgentStatus } from "~/lib/types";

const LABEL = "dindang.managed";
const IMAGE = "node:22-slim";

const docker = new Docker();

// In-memory store for exec output (container logs only capture the main process)
const execOutputs = new Map<string, string>();

// Track agent metadata that Docker labels can't easily store
const agentMeta = new Map<string, { projectId: string; machineId: string }>();

function mapStatus(state: { Running?: boolean; Status?: string; ExitCode?: number }): AgentStatus {
  if (state.Running) return "ready";
  if (state.Status === "created") return "provisioning";
  if (state.Status === "exited" && state.ExitCode === 0) return "ready";
  if (state.Status === "exited") return "error";
  return "provisioning";
}

function inspectToAgent(info: Docker.ContainerInspectInfo): Agent {
  const name = info.Name.replace(/^\//, "");
  const meta = agentMeta.get(name);
  const labels = info.Config.Labels || {};

  return {
    id: info.Id,
    name,
    projectId: meta?.projectId || labels["dindang.project"] || "",
    machineId: meta?.machineId || "localhost",
    containerId: info.Id,
    status: mapStatus(info.State),
    createdAt: info.Created,
  };
}

function containerToAgent(c: Docker.ContainerInfo): Agent {
  const name = c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
  const meta = agentMeta.get(name);
  const labels = c.Labels || {};

  let status: AgentStatus;
  if (c.State === "running") status = "ready";
  else if (c.State === "created") status = "provisioning";
  else if (c.State === "exited" && c.Status?.includes("Exited (0)")) status = "ready";
  else if (c.State === "exited") status = "error";
  else status = "provisioning";

  return {
    id: c.Id,
    name,
    projectId: meta?.projectId || labels["dindang.project"] || "",
    machineId: meta?.machineId || "localhost",
    containerId: c.Id,
    status,
    createdAt: new Date(c.Created * 1000).toISOString(),
  };
}

async function execInContainer(
  container: Docker.Container,
  cmd: string[]
): Promise<string> {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  return new Promise((resolve) => {
    let output = "";
    stream.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    stream.on("end", () => resolve(output));
  });
}

export const dockerProvider: DeploymentProvider = {
  async create(options) {
    // Ensure image exists
    try {
      await docker.getImage(IMAGE).inspect();
    } catch {
      const stream = await docker.pull(IMAGE);
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (err: Error | null) =>
          err ? reject(err) : resolve()
        );
      });
    }

    const container = await docker.createContainer({
      Image: IMAGE,
      name: options.name,
      Labels: {
        [LABEL]: "true",
        "dindang.project": options.projectId,
      },
      Tty: true,
      OpenStdin: true,
      Env: [
        `ANTHROPIC_API_KEY=${options.anthropicApiKey}`,
        `GITHUB_TOKEN=${options.githubToken}`,
      ],
      Cmd: ["bash", "-c", "trap 'exit 0' TERM; while true; do sleep 1; done"],
    });
    await container.start();

    // Store metadata
    agentMeta.set(options.name, { projectId: options.projectId, machineId: "localhost" });

    // Install git and clone repo in background
    const setupSteps: string[] = [
      "apt-get update -qq && apt-get install -y -qq git curl build-essential > /dev/null 2>&1",
    ];

    // Clone repo
    const repoUrl = options.repoUrl.startsWith("http")
      ? options.repoUrl
      : `https://${options.repoUrl}`;
    const authedUrl = options.githubToken
      ? repoUrl.replace("https://", `https://${options.githubToken}@`)
      : repoUrl;
    setupSteps.push(`git clone ${authedUrl} /workspace > /dev/null 2>&1`);

    // Install Claude Code
    setupSteps.push("curl -fsSL https://claude.ai/install.sh | bash > /dev/null 2>&1");

    // Write Claude Code hooks config
    const hooksConfig = JSON.stringify({
      hooks: {
        PostToolUse: [{
          hooks: [{
            type: "http",
            url: `http://${options.dindangHost}/api/hooks/agent/${options.name}`,
          }],
        }],
        Stop: [{
          hooks: [{
            type: "http",
            url: `http://${options.dindangHost}/api/hooks/agent/${options.name}`,
          }],
        }],
      },
    });
    const escapedHooksConfig = hooksConfig.replace(/'/g, "'\\''");
    setupSteps.push(`mkdir -p /workspace/.claude && echo '${escapedHooksConfig}' > /workspace/.claude/settings.json`);

    // Run user setup command
    if (options.setupCommand) {
      setupSteps.push(`cd /workspace && ${options.setupCommand}`);
    }

    // Run all setup in background — don't block the response
    const fullSetup = setupSteps.join(" && ");
    const exec = await container.exec({
      Cmd: ["bash", "-c", fullSetup],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    stream.on("data", (chunk: Buffer) => {
      execOutputs.set(
        options.name,
        (execOutputs.get(options.name) ?? "") + chunk.toString()
      );
    });

    const info = await container.inspect();
    return inspectToAgent(info);
  },

  async exec(nameOrId, command) {
    const container = docker.getContainer(nameOrId);
    const exec = await container.exec({
      Cmd: ["bash", "-c", `cd /workspace && ${command}`],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    stream.on("data", (chunk: Buffer) => {
      execOutputs.set(
        nameOrId,
        (execOutputs.get(nameOrId) ?? "") + chunk.toString()
      );
    });
  },

  async stop(nameOrId) {
    const container = docker.getContainer(nameOrId);
    await container.stop();
  },

  async remove(nameOrId) {
    const container = docker.getContainer(nameOrId);
    try {
      await container.stop();
    } catch {
      // may already be stopped
    }
    await container.remove();
    execOutputs.delete(nameOrId);
    agentMeta.delete(nameOrId);
  },

  async getStatus(nameOrId) {
    const container = docker.getContainer(nameOrId);
    const info = await container.inspect();
    return inspectToAgent(info);
  },

  async getLogs(nameOrId) {
    return execOutputs.get(nameOrId) ?? "";
  },

  async list() {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: [LABEL] },
    });
    return containers.map(containerToAgent);
  },
};
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/runa/dindang && npx tsc --noEmit src/server/docker-provider.ts 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/server/docker-provider.ts
git commit -m "feat: update docker provider with Claude Code runtime setup, repo cloning, and hooks"
```

---

### Task 11: Update Server Functions for Agent CRUD

**Files:**
- Modify: `src/server/agents.ts`

- [ ] **Step 1: Update agents.ts to accept projectId and pass config to provider**

Replace entire contents of `src/server/agents.ts`:

```typescript
import { createServerFn } from "@tanstack/react-start";
import { dockerProvider } from "./docker-provider";
import { getSettings } from "~/lib/config";
import { randomName } from "~/lib/names";

export const listAgents = createServerFn({ method: "GET" }).handler(async () => {
  return dockerProvider.list();
});

export const getAgent = createServerFn({ method: "GET" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }) => {
    return dockerProvider.getStatus(name);
  });

export const createAgent = createServerFn({ method: "POST" })
  .inputValidator((data: { projectId: string }) => data)
  .handler(async ({ data }) => {
    const settings = getSettings();
    const project = settings.projects.find((p) => p.id === data.projectId);
    if (!project) throw new Error("Project not found");
    if (!settings.anthropicApiKey) throw new Error("Anthropic API key not configured — go to Settings");

    const name = randomName();
    return dockerProvider.create({
      name,
      projectId: project.id,
      repoUrl: project.repoUrl,
      githubToken: settings.githubToken,
      anthropicApiKey: settings.anthropicApiKey,
      setupCommand: project.setupCommand,
      dindangHost: "host.docker.internal:3000",
    });
  });

export const execAgent = createServerFn({ method: "POST" })
  .inputValidator((data: { name: string; command: string }) => data)
  .handler(async ({ data }) => {
    await dockerProvider.exec(data.name, data.command);
    return dockerProvider.getStatus(data.name);
  });

export const stopAgent = createServerFn({ method: "POST" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }) => {
    await dockerProvider.stop(name);
    return dockerProvider.getStatus(name);
  });

export const removeAgent = createServerFn({ method: "POST" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }) => {
    await dockerProvider.remove(name);
    return { ok: true };
  });

export const getAgentLogs = createServerFn({ method: "GET" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }) => {
    return dockerProvider.getLogs(name);
  });
```

Note: `startAgent` renamed to `execAgent` to match provider rename. `dindangHost` uses `host.docker.internal:3000` so containers can reach the host machine.

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/runa/dindang && npx tsc --noEmit src/server/agents.ts 2>&1 | head -10`

- [ ] **Step 3: Commit**

```bash
git add src/server/agents.ts
git commit -m "feat: update agent server functions with project-aware creation"
```

---

### Task 12: Update Dashboard with Project Dropdown

**Files:**
- Modify: `src/routes/index.tsx`

- [ ] **Step 1: Rewrite dashboard with project dropdown on create**

Replace entire contents of `src/routes/index.tsx`:

```tsx
import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useState } from "react";
import { listAgents, createAgent } from "~/server/agents";
import { listProjects } from "~/server/settings";
import { AgentCard } from "~/components/agent-card";
import type { Project } from "~/lib/types";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [agents, projects] = await Promise.all([listAgents(), listProjects()]);
    return { agents, projects };
  },
  component: Dashboard,
});

function Dashboard() {
  const { agents, projects } = Route.useLoaderData();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string>(
    () => projects.find((p: Project) => p.isDefault)?.id ?? projects[0]?.id ?? ""
  );

  const handleCreate = async () => {
    if (!selectedProject) return;
    setCreating(true);
    setError(null);
    try {
      await createAgent({ data: { projectId: selectedProject } });
      await router.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const projectMap = new Map(projects.map((p: Project) => [p.id, p.name]));

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">agents</h1>
        <div className="flex items-center gap-2">
          {projects.length > 0 ? (
            <>
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-zinc-500 cursor-pointer"
              >
                {projects.map((p: Project) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
              >
                {creating ? "creating..." : "+ new"}
              </button>
            </>
          ) : (
            <Link
              to="/settings"
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors"
            >
              configure a project first
            </Link>
          )}
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-sm mb-4">Error: {error}</p>
      )}

      {agents.length === 0 ? (
        <p className="text-zinc-600 text-sm">
          {projects.length === 0
            ? "Add a project in settings, then create agents here."
            : "No agents yet. Select a project and click \"+ new\"."}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              projectName={projectMap.get(agent.projectId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles and loads**

Run: `cd /home/runa/dindang && npx tsc --noEmit src/routes/index.tsx 2>&1 | head -10`
Then open `http://localhost:3000` and verify the project dropdown appears (or "configure a project first" link if no projects).

- [ ] **Step 3: Commit**

```bash
git add src/routes/index.tsx
git commit -m "feat: add project dropdown to agent creation on dashboard"
```

---

### Task 13: Update Agent Detail Page

**Files:**
- Modify: `src/routes/agent.$name.tsx`

- [ ] **Step 1: Update imports — rename startAgent to execAgent**

In `src/routes/agent.$name.tsx`, update the import:

Change:
```typescript
import {
  getAgent,
  startAgent,
  stopAgent,
  removeAgent,
  getAgentLogs,
} from "~/server/agents";
```

To:
```typescript
import {
  getAgent,
  execAgent,
  stopAgent,
  removeAgent,
  getAgentLogs,
} from "~/server/agents";
```

- [ ] **Step 2: Update handleSubmit to use execAgent**

In the `handleSubmit` function, change `startAgent` to `execAgent`:

Change:
```typescript
await startAgent({ data: { name, command: cmd } });
```

To:
```typescript
await execAgent({ data: { name, command: cmd } });
```

- [ ] **Step 3: Update status checks for new AgentStatus values**

The old status `"running"` no longer exists. Update the stop button conditional:

Change:
```tsx
{agent.status === "running" && (
```

To:
```tsx
{agent.status === "busy" && (
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /home/runa/dindang && npx tsc --noEmit src/routes/agent.\\$name.tsx 2>&1 | head -10`

- [ ] **Step 5: Commit**

```bash
git add src/routes/agent.\$name.tsx
git commit -m "feat: update agent detail page to use execAgent and new status values"
```

---

### Task 14: Pull node:22-slim Image

- [ ] **Step 1: Pull the new base image**

Run: `docker pull node:22-slim`
Expected: Image downloaded successfully.

- [ ] **Step 2: Verify**

Run: `docker images node:22-slim`
Expected: Image listed.

---

### Task 15: End-to-End Smoke Test

- [ ] **Step 1: Start dev server**

Run: `cd /home/runa/dindang && npx vite dev --port 3000`

- [ ] **Step 2: Configure settings**

1. Open `http://localhost:3000/settings`
2. Enter an Anthropic API key and save
3. Add a project (use a small public repo like `https://github.com/octocat/Hello-World`, no setup command, set as default)

- [ ] **Step 3: Create an agent**

1. Go to `http://localhost:3000`
2. Select the project from the dropdown
3. Click "+ new"
4. Verify agent card appears with "provisioning" or "ready" status
5. Click into the agent
6. Run `echo "hello"` in the terminal
7. Verify output appears

- [ ] **Step 4: Commit all remaining changes**

```bash
git add src/lib/types.ts src/lib/crypto.ts src/lib/config.ts src/lib/provider.ts src/server/settings.ts src/server/agents.ts src/server/docker-provider.ts src/routes/__root.tsx src/routes/index.tsx src/routes/settings.tsx src/routes/agent.\$name.tsx src/components/agent-card.tsx src/components/status-badge.tsx docs/superpowers/
git commit -m "feat: runtime adapter and orchestration v1 — settings, projects, Claude Code containers"
```
