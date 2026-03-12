# Agent Dashboard POC Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web dashboard where developers can one-click deploy agent containers, assign shell commands, and monitor live output.

**Architecture:** TanStack Start full-stack app. Server functions call Docker via dockerode. No database — Docker containers are the source of truth, labeled for filtering. Log streaming via async generators from server functions.

**Tech Stack:** TanStack Start, TanStack Router, React, dockerode, TypeScript, Tailwind CSS (minimal dark theme)

---

## File Structure

```
app/
  routes/
    __root.tsx          # Root layout (dark theme, monospace)
    index.tsx           # Dashboard page — flex grid of agent cards
    agent.$id.tsx       # Agent detail page — logs, prompt, actions
  components/
    agent-card.tsx      # Card component for dashboard grid
    status-badge.tsx    # Status badge (idle/running/done/error)
    log-viewer.tsx      # Streaming log viewer
  lib/
    provider.ts         # DeploymentProvider interface
    docker-provider.ts  # Docker implementation of DeploymentProvider
    names.ts            # Random name generator (adjective-noun)
    types.ts            # Shared types (Agent, AgentStatus)
  server/
    agents.ts           # Server functions (createServerFn) for CRUD + logs
app.config.ts           # TanStack Start config
package.json
tsconfig.json
```

---

## Chunk 1: Project Scaffold & Types

### Task 1: Initialize TanStack Start project

**Files:**
- Create: `package.json`
- Create: `app.config.ts`
- Create: `tsconfig.json`
- Create: `app/routes/__root.tsx`

- [ ] **Step 1: Scaffold the project**

```bash
cd /home/runa/dindang
npm create @tanstack/app@latest . -- --template start-basic
```

If the interactive prompt doesn't work, manually create the files:

```bash
npm init -y
npm install @tanstack/react-start @tanstack/react-router react react-dom vinxi
npm install -D typescript @types/react @types/react-dom tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Create app.config.ts**

```ts
import { defineConfig } from "@tanstack/react-start/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  vite: {
    plugins: () => [tailwindcss()],
  },
});
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "moduleResolution": "Bundler",
    "module": "ESNext",
    "target": "ES2022",
    "strict": true,
    "skipLibCheck": true,
    "paths": {
      "~/*": ["./app/*"]
    }
  }
}
```

- [ ] **Step 4: Create root layout with dark theme**

`app/routes/__root.tsx`:

```tsx
import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>dindang</title>
      </head>
      <body className="bg-zinc-950 text-zinc-100 font-mono min-h-screen">
        <Outlet />
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Verify dev server starts**

```bash
npm run dev
```

Expected: Dev server starts on localhost:3000, shows blank dark page.

- [ ] **Step 6: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold TanStack Start project with dark theme"
```

---

### Task 2: Define shared types and name generator

**Files:**
- Create: `app/lib/types.ts`
- Create: `app/lib/names.ts`
- Create: `app/lib/provider.ts`

- [ ] **Step 1: Create types**

`app/lib/types.ts`:

```ts
export type AgentStatus = "idle" | "running" | "done" | "error";

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  command?: string;
  createdAt: string;
}
```

- [ ] **Step 2: Create name generator**

`app/lib/names.ts`:

```ts
const adjectives = [
  "bold", "calm", "dark", "fast", "keen",
  "loud", "neat", "pure", "safe", "warm",
  "blue", "cold", "deep", "firm", "gray",
  "lean", "mild", "open", "rare", "soft",
];

const nouns = [
  "arc", "bay", "cup", "dot", "elm",
  "fox", "gem", "hub", "ink", "jet",
  "key", "log", "map", "net", "orb",
  "pin", "ray", "sun", "tip", "vue",
];

export function randomName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}-${noun}-${num}`;
}
```

- [ ] **Step 3: Create DeploymentProvider interface**

`app/lib/provider.ts`:

```ts
import type { Agent } from "./types";

export interface DeploymentProvider {
  create(name: string): Promise<Agent>;
  start(id: string, command: string): Promise<void>;
  stop(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  getStatus(id: string): Promise<Agent>;
  getLogs(id: string): AsyncIterable<string>;
  list(): Promise<Agent[]>;
}
```

- [ ] **Step 4: Commit**

```bash
git add app/lib/types.ts app/lib/names.ts app/lib/provider.ts
git commit -m "feat: add shared types, name generator, and provider interface"
```

---

## Chunk 2: Docker Provider

### Task 3: Implement DockerProvider

**Files:**
- Create: `app/lib/docker-provider.ts`

- [ ] **Step 1: Install dockerode**

```bash
npm install dockerode
npm install -D @types/dockerode
```

- [ ] **Step 2: Implement DockerProvider**

`app/lib/docker-provider.ts`:

```ts
import Docker from "dockerode";
import type { DeploymentProvider } from "./provider";
import type { Agent, AgentStatus } from "./types";

const LABEL = "dindang.managed";
const IMAGE = "debian:bookworm-slim";

const docker = new Docker();

function containerToAgent(container: Docker.ContainerInfo): Agent {
  const state = container.State;
  const exitCode = container.Status?.includes("Exited (0)");

  let status: AgentStatus;
  if (state === "running") {
    status = "running";
  } else if (state === "created") {
    status = "idle";
  } else if (state === "exited" && exitCode) {
    status = "done";
  } else if (state === "exited") {
    status = "error";
  } else {
    status = "idle";
  }

  return {
    id: container.Id,
    name: container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12),
    status,
    command: container.Command || undefined,
    createdAt: new Date(container.Created * 1000).toISOString(),
  };
}

async function inspectToAgent(info: Docker.ContainerInspectInfo): Promise<Agent> {
  const state = info.State;
  let status: AgentStatus;

  if (state.Running) {
    status = "running";
  } else if (state.Status === "created") {
    status = "idle";
  } else if (state.ExitCode === 0 && state.Status === "exited") {
    status = "done";
  } else if (state.Status === "exited") {
    status = "error";
  } else {
    status = "idle";
  }

  return {
    id: info.Id,
    name: info.Name.replace(/^\//, ""),
    status,
    command: info.Config.Cmd?.join(" ") || undefined,
    createdAt: info.Created,
  };
}

export const dockerProvider: DeploymentProvider = {
  async create(name: string): Promise<Agent> {
    // Pull image if not present (ignore errors if already exists)
    try {
      const stream = await docker.pull(IMAGE);
      await new Promise((resolve, reject) => {
        docker.modem.followProgress(stream, (err: Error | null) =>
          err ? reject(err) : resolve(undefined)
        );
      });
    } catch {
      // Image may already exist locally
    }

    const container = await docker.createContainer({
      Image: IMAGE,
      name,
      Labels: { [LABEL]: "true" },
      Tty: true,
      OpenStdin: true,
      Cmd: ["/bin/bash"],
    });

    const info = await container.inspect();
    return inspectToAgent(info);
  },

  async start(id: string, command: string): Promise<void> {
    const container = docker.getContainer(id);
    const info = await container.inspect();

    // If container is already running or was started before, remove and recreate
    if (info.State.Status !== "created") {
      const name = info.Name.replace(/^\//, "");
      try { await container.stop(); } catch { /* may already be stopped */ }
      await container.remove();
      const newContainer = await docker.createContainer({
        Image: IMAGE,
        name,
        Labels: { [LABEL]: "true" },
        Tty: true,
        Cmd: ["bash", "-c", command],
      });
      await newContainer.start();
      return;
    }

    // Fresh container — update command isn't possible, so remove and recreate
    const name = info.Name.replace(/^\//, "");
    await container.remove();
    const newContainer = await docker.createContainer({
      Image: IMAGE,
      name,
      Labels: { [LABEL]: "true" },
      Tty: true,
      Cmd: ["bash", "-c", command],
    });
    await newContainer.start();
  },

  async stop(id: string): Promise<void> {
    const container = docker.getContainer(id);
    await container.stop();
  },

  async remove(id: string): Promise<void> {
    const container = docker.getContainer(id);
    try { await container.stop(); } catch { /* may already be stopped */ }
    await container.remove();
  },

  async getStatus(id: string): Promise<Agent> {
    const container = docker.getContainer(id);
    const info = await container.inspect();
    return inspectToAgent(info);
  },

  async *getLogs(id: string): AsyncIterable<string> {
    const container = docker.getContainer(id);
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 100,
    });

    const readable = stream as unknown as NodeJS.ReadableStream;
    for await (const chunk of readable) {
      // Docker TTY mode sends raw text, non-TTY has 8-byte header per frame
      yield chunk.toString();
    }
  },

  async list(): Promise<Agent[]> {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: [LABEL] },
    });
    return containers.map(containerToAgent);
  },
};
```

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/docker-provider.ts package.json package-lock.json
git commit -m "feat: implement DockerProvider with dockerode"
```

---

## Chunk 3: Server Functions

### Task 4: Create server functions for agent CRUD and log streaming

**Files:**
- Create: `app/server/agents.ts`

- [ ] **Step 1: Create server functions**

`app/server/agents.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { dockerProvider } from "~/lib/docker-provider";
import { randomName } from "~/lib/names";

export const listAgents = createServerFn({ method: "GET" }).handler(async () => {
  return dockerProvider.list();
});

export const getAgent = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    return dockerProvider.getStatus(id);
  });

export const createAgent = createServerFn({ method: "POST" }).handler(async () => {
  const name = randomName();
  return dockerProvider.create(name);
});

export const startAgent = createServerFn({ method: "POST" })
  .validator((data: { id: string; command: string }) => data)
  .handler(async ({ data }) => {
    await dockerProvider.start(data.id, data.command);
    return dockerProvider.getStatus(data.id);
  });

export const stopAgent = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    await dockerProvider.stop(id);
    return dockerProvider.getStatus(id);
  });

export const removeAgent = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    await dockerProvider.remove(id);
    return { ok: true };
  });

export const streamAgentLogs = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async function* ({ data: id }) {
    for await (const chunk of dockerProvider.getLogs(id)) {
      yield chunk;
    }
  });
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/server/agents.ts
git commit -m "feat: add server functions for agent CRUD and log streaming"
```

---

## Chunk 4: UI Components

### Task 5: Build reusable components

**Files:**
- Create: `app/components/status-badge.tsx`
- Create: `app/components/agent-card.tsx`
- Create: `app/components/log-viewer.tsx`

- [ ] **Step 1: Create StatusBadge**

`app/components/status-badge.tsx`:

```tsx
import type { AgentStatus } from "~/lib/types";

const styles: Record<AgentStatus, string> = {
  idle: "bg-zinc-700 text-zinc-300",
  running: "bg-blue-900 text-blue-300",
  done: "bg-green-900 text-green-300",
  error: "bg-red-900 text-red-300",
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs uppercase tracking-wide ${styles[status]}`}>
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Create AgentCard**

`app/components/agent-card.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import type { Agent } from "~/lib/types";
import { StatusBadge } from "./status-badge";

export function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Link
      to="/agent/$id"
      params={{ id: agent.id }}
      className="block border border-zinc-800 rounded-lg p-4 hover:border-zinc-600 transition-colors bg-zinc-900"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium truncate">{agent.name}</span>
        <StatusBadge status={agent.status} />
      </div>
      {agent.command && (
        <p className="text-xs text-zinc-500 truncate font-mono">{agent.command}</p>
      )}
      <p className="text-xs text-zinc-600 mt-2">
        {new Date(agent.createdAt).toLocaleTimeString()}
      </p>
    </Link>
  );
}
```

- [ ] **Step 3: Create LogViewer**

`app/components/log-viewer.tsx`:

```tsx
import { useEffect, useRef } from "react";

export function LogViewer({ lines }: { lines: string[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  return (
    <div className="bg-black rounded-lg p-4 h-96 overflow-y-auto text-sm text-zinc-300 font-mono">
      {lines.length === 0 ? (
        <span className="text-zinc-600">No output yet.</span>
      ) : (
        lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add app/components/
git commit -m "feat: add StatusBadge, AgentCard, and LogViewer components"
```

---

## Chunk 5: Dashboard Page

### Task 6: Build the dashboard route

**Files:**
- Create: `app/routes/index.tsx`

- [ ] **Step 1: Implement dashboard page**

`app/routes/index.tsx`:

```tsx
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { listAgents, createAgent } from "~/server/agents";
import { AgentCard } from "~/components/agent-card";

export const Route = createFileRoute("/")({
  loader: () => listAgents(),
  component: Dashboard,
});

function Dashboard() {
  const agents = Route.useLoaderData();
  const router = useRouter();

  const handleCreate = async () => {
    await createAgent();
    router.invalidate();
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">agents</h1>
        <button
          onClick={handleCreate}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-sm transition-colors cursor-pointer"
        >
          + new
        </button>
      </div>

      {agents.length === 0 ? (
        <p className="text-zinc-600 text-sm">No agents yet. Click "+ new" to create one.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the dashboard loads**

```bash
npm run dev
```

Open `http://localhost:3000`. Expected: dark page with "agents" heading and "+ new" button.

- [ ] **Step 3: Commit**

```bash
git add app/routes/index.tsx
git commit -m "feat: add dashboard page with agent grid"
```

---

## Chunk 6: Agent Detail Page

### Task 7: Build the agent detail route

**Files:**
- Create: `app/routes/agent.$id.tsx`

- [ ] **Step 1: Implement agent detail page**

`app/routes/agent.$id.tsx`:

```tsx
import { createFileRoute, useRouter, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { getAgent, startAgent, stopAgent, removeAgent, streamAgentLogs } from "~/server/agents";
import { StatusBadge } from "~/components/status-badge";
import { LogViewer } from "~/components/log-viewer";

export const Route = createFileRoute("/agent/$id")({
  loader: ({ params }) => getAgent({ data: params.id }),
  component: AgentDetail,
});

function AgentDetail() {
  const agent = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [command, setCommand] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);

  const refreshAgent = useCallback(() => {
    router.invalidate();
  }, [router]);

  // Stream logs when agent is running
  useEffect(() => {
    if (agent.status !== "running") {
      setStreaming(false);
      return;
    }

    let cancelled = false;
    setStreaming(true);

    (async () => {
      try {
        const stream = await streamAgentLogs({ data: agent.id });
        for await (const chunk of stream) {
          if (cancelled) break;
          setLogs((prev) => [...prev, chunk]);
        }
      } catch {
        // Stream ended or container stopped
      } finally {
        if (!cancelled) {
          setStreaming(false);
          refreshAgent();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent.id, agent.status, refreshAgent]);

  const handleStart = async () => {
    if (!command.trim()) return;
    setLogs([]);
    await startAgent({ data: { id: agent.id, command: command.trim() } });
    refreshAgent();
  };

  const handleStop = async () => {
    await stopAgent({ data: agent.id });
    refreshAgent();
  };

  const handleRemove = async () => {
    await removeAgent({ data: agent.id });
    navigate({ to: "/" });
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate({ to: "/" })}
          className="text-zinc-500 hover:text-zinc-300 text-sm cursor-pointer"
        >
          &larr; back
        </button>
        <h1 className="text-xl font-bold">{agent.name}</h1>
        <StatusBadge status={agent.status} />
      </div>

      {/* Command input */}
      <div className="mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleStart()}
            placeholder="bash -c 'echo hello && sleep 5 && echo done'"
            className="flex-1 bg-black border border-zinc-800 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
            disabled={agent.status === "running"}
          />
          <button
            onClick={handleStart}
            disabled={agent.status === "running" || !command.trim()}
            className="px-4 py-2 bg-blue-900 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm transition-colors cursor-pointer"
          >
            run
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mb-4">
        {agent.status === "running" && (
          <button
            onClick={handleStop}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-sm transition-colors cursor-pointer"
          >
            stop
          </button>
        )}
        <button
          onClick={handleRemove}
          className="px-3 py-1.5 bg-red-950 hover:bg-red-900 text-red-300 rounded text-sm transition-colors cursor-pointer"
        >
          remove
        </button>
      </div>

      {/* Logs */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm text-zinc-500">output</span>
          {streaming && (
            <span className="text-xs text-blue-400 animate-pulse">streaming...</span>
          )}
        </div>
        <LogViewer lines={logs} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Test the full flow**

```bash
npm run dev
```

1. Open `http://localhost:3000`
2. Click "+ new" — card should appear with idle status
3. Click the card — navigates to detail page
4. Enter `echo "hello world" && sleep 3 && echo "done"` and click "run"
5. Logs should stream in, status goes to running then done
6. Click "remove" — navigates back to dashboard, card gone

- [ ] **Step 3: Commit**

```bash
git add app/routes/agent.\$id.tsx
git commit -m "feat: add agent detail page with log streaming"
```

---

## Chunk 7: Polish & Global Styles

### Task 8: Add Tailwind CSS and final polish

**Files:**
- Create: `app/styles.css`
- Modify: `app/routes/__root.tsx`

- [ ] **Step 1: Create global styles**

`app/styles.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 2: Import styles in root layout**

Update `app/routes/__root.tsx` to import the stylesheet. Add at the top:

```tsx
import appCss from "~/styles.css?url";
```

Add a `head` configuration to the route:

```tsx
export const Route = createRootRoute({
  component: RootLayout,
  head: () => ({
    links: [{ rel: "stylesheet", href: appCss }],
  }),
});
```

- [ ] **Step 3: Verify everything works end-to-end**

```bash
npm run dev
```

Full flow test: create agent, run command, see logs stream, stop, remove.

- [ ] **Step 4: Commit**

```bash
git add app/styles.css app/routes/__root.tsx
git commit -m "feat: add Tailwind CSS styles"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Scaffold TanStack Start | package.json, app.config.ts, tsconfig.json, __root.tsx |
| 2 | Types & name generator | types.ts, names.ts, provider.ts |
| 3 | DockerProvider | docker-provider.ts |
| 4 | Server functions | server/agents.ts |
| 5 | UI components | status-badge.tsx, agent-card.tsx, log-viewer.tsx |
| 6 | Dashboard page | routes/index.tsx |
| 7 | Agent detail page | routes/agent.$id.tsx |
| 8 | Tailwind & polish | styles.css, __root.tsx update |
