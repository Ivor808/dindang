# xterm.js Terminal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bespoke polling-based terminal with xterm.js + WebSocket + Docker PTY so interactive TUI apps (Claude Code) work properly.

**Architecture:** WebSocket server attached to Vite's dev HTTP server via plugin. On connection, it creates a Docker exec with a PTY-attached bash shell in the container's `/workspace` directory. xterm.js renders the terminal in the browser and sends keystrokes over WebSocket. All terminal I/O flows bidirectionally through the WebSocket — no polling.

**Tech Stack:** `ws` (WebSocket server), `@xterm/xterm` + `@xterm/addon-fit` (terminal emulator), `dockerode` exec with PTY.

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
npm install ws @xterm/xterm @xterm/addon-fit --legacy-peer-deps
npm install -D @types/ws --legacy-peer-deps
```

- [ ] **Step 2: Verify installation**

Run: `node -e "require('ws'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add ws and xterm.js dependencies"
```

---

### Task 2: Create WebSocket terminal server

**Files:**
- Create: `src/server/terminal.ts`

The WebSocket server handles upgrade requests at `/ws/terminal/:agentName`. On connection it creates a Docker exec with a PTY (interactive bash login shell), pipes stdin/stdout bidirectionally between the WebSocket and the Docker stream, and handles terminal resize messages.

Messages from the client are either raw input (string) or JSON control messages like `{"type":"resize","cols":80,"rows":24}`.

- [ ] **Step 1: Create `src/server/terminal.ts`**

```typescript
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import Docker from "dockerode";

const docker = new Docker();
const activeSessions = new Map<WebSocket, { stream: NodeJS.ReadWriteStream; exec: Docker.Exec }>();

export function attachTerminalWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const match = req.url?.match(/^\/ws\/terminal\/(.+)$/);
    if (!match) return; // let Vite HMR handle other upgrades

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", async (ws, req) => {
    const agentName = req.url!.match(/^\/ws\/terminal\/(.+)$/)![1]!;

    try {
      const container = docker.getContainer(agentName);

      const exec = await container.exec({
        Cmd: ["bash", "-l"],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Env: ["TERM=xterm-256color", 'PATH=/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
        WorkingDir: "/workspace",
      });

      const stream = await exec.start({ hijack: true, stdin: true, Tty: true });

      activeSessions.set(ws, { stream, exec });

      // Docker → browser
      stream.on("data", (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        }
      });

      stream.on("end", () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });

      // Browser → Docker
      ws.on("message", (data) => {
        const msg = data.toString();

        // Check for control messages (JSON with type field)
        if (msg.startsWith("{")) {
          try {
            const ctrl = JSON.parse(msg);
            if (ctrl.type === "resize" && ctrl.cols && ctrl.rows) {
              exec.resize({ h: ctrl.rows, w: ctrl.cols });
              return;
            }
          } catch {
            // not JSON, treat as regular input
          }
        }

        stream.write(data);
      });

      ws.on("close", () => {
        stream.end();
        activeSessions.delete(ws);
      });

      ws.on("error", () => {
        stream.end();
        activeSessions.delete(ws);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\nFailed to connect: ${msg}\r\n`);
        ws.close();
      }
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/terminal.ts
git commit -m "feat: add WebSocket terminal server with Docker PTY"
```

---

### Task 3: Attach WebSocket server to Vite

**Files:**
- Modify: `vite.config.ts`

Use Vite's `configureServer` plugin hook to attach the WebSocket upgrade handler to Vite's underlying HTTP server. This runs in dev mode. Production will need a separate setup later.

- [ ] **Step 1: Add WebSocket plugin to vite.config.ts**

Replace the full file with:

```typescript
import path from "path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import type { Plugin } from "vite";

function dindangWebSocket(): Plugin {
  return {
    name: "dindang-ws",
    configureServer(server) {
      server.httpServer?.on("listening", async () => {
        const { attachTerminalWebSocket } = await import("./src/server/terminal.ts");
        attachTerminalWebSocket(server.httpServer!);
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), dindangWebSocket()],
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "./src"),
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
});
```

- [ ] **Step 2: Verify dev server starts**

Run: `npm run dev`
Expected: Server starts on port 3000 without errors.

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts
git commit -m "feat: attach terminal WebSocket to Vite dev server"
```

---

### Task 4: Rewrite agent detail page with xterm.js

**Files:**
- Modify: `src/routes/agent.$name.tsx`

Replace the entire custom terminal (input field, termLines state, polling, command history) with an xterm.js `Terminal` instance that connects to the WebSocket. Keep the header bar with status badge, stop, and remove buttons. Poll agent status every 5 seconds for the header only (no log polling).

The xterm.js CSS must be imported for the terminal to render correctly.

- [ ] **Step 1: Rewrite `src/routes/agent.$name.tsx`**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { getAgent, stopAgent, removeAgent } from "~/server/agents";
import { StatusBadge } from "~/components/status-badge";
import type { Agent } from "~/lib/types";
import { toErrorMessage } from "~/lib/errors";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export const Route = createFileRoute("/agent/$name")({
  loader: ({ params }) => getAgent({ data: params.name }),
  component: AgentDetail,
});

function AgentDetail() {
  const initialAgent = Route.useLoaderData();
  const { name } = Route.useParams();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent>(initialAgent);
  const [error, setError] = useState<string | null>(null);

  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Poll agent status for header
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const status = await getAgent({ data: name });
        setAgent(status);
      } catch {
        // container may have been removed
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [name]);

  // Initialize xterm + WebSocket
  useEffect(() => {
    if (!termContainerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: "#000000",
        foreground: "#d4d4d8",
        cursor: "#4ade80",
        selectionBackground: "#3f3f46",
      },
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termContainerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Connect WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal/${name}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      // Send initial size
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event) => {
      const data = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : event.data;
      term.write(data);
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[90m[connection closed]\x1b[0m\r\n");
    };

    ws.onerror = () => {
      term.write("\r\n\x1b[31m[connection error]\x1b[0m\r\n");
    };

    // Terminal input → WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle resize
    const onResize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(termContainerRef.current);

    // Focus terminal
    term.focus();

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
    };
  }, [name]);

  const handleStop = async () => {
    try {
      const updated = await stopAgent({ data: name });
      setAgent(updated);
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const handleRemove = async () => {
    try {
      wsRef.current?.close();
      await removeAgent({ data: name });
      navigate({ to: "/" });
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate({ to: "/" })}
            className="text-zinc-500 hover:text-zinc-300 text-sm cursor-pointer"
          >
            &larr; back
          </button>
          <h1 className="text-xl font-bold">{agent.name}</h1>
          <StatusBadge status={agent.status} />
        </div>
        <div className="flex gap-2">
          {agent.status === "busy" && (
            <button
              onClick={handleStop}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors cursor-pointer"
            >
              stop
            </button>
          )}
          <button
            onClick={handleRemove}
            className="px-3 py-1.5 bg-red-950 hover:bg-red-900 text-red-300 rounded text-xs transition-colors cursor-pointer"
          >
            remove
          </button>
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-sm mb-2">Error: {error}</p>
      )}

      {/* Terminal */}
      <div className="flex-1 bg-black rounded-lg border border-zinc-800 flex flex-col min-h-0 overflow-hidden">
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <span className="text-xs text-zinc-500 ml-2">{agent.name}</span>
        </div>

        {/* xterm container */}
        <div
          ref={termContainerRef}
          className="flex-1 min-h-0 p-1"
          onClick={() => termRef.current?.focus()}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify terminal renders**

Run: `npm run dev`, navigate to an agent page.
Expected: xterm.js terminal renders with a bash prompt. Typing sends input, output appears in real-time. `ls`, `pwd`, `claude --version` all work.

- [ ] **Step 3: Commit**

```bash
git add src/routes/agent.\$name.tsx
git commit -m "feat: replace bespoke terminal with xterm.js + WebSocket"
```

---

### Task 5: Clean up dead code

**Files:**
- Modify: `src/server/agents.ts` — remove `execAgent`, `getAgentLogs`
- Modify: `src/lib/provider.ts` — remove `exec` and `getLogs` from interface
- Modify: `src/server/docker-provider.ts` — remove `exec` method, `getLogs` method; keep `appendOutput`/`runExec`/`execOutputs` (used by `setupContainer`)
- Modify: `src/routes/index.tsx` — remove `toErrorMessage` import if `execAgent` was referenced

- [ ] **Step 1: Update `src/lib/provider.ts`**

Remove `exec` and `getLogs` from the `DeploymentProvider` interface:

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
  stop(nameOrId: string): Promise<void>;
  remove(nameOrId: string): Promise<void>;
  getStatus(nameOrId: string): Promise<Agent>;
  list(): Promise<Agent[]>;
}
```

- [ ] **Step 2: Update `src/server/docker-provider.ts`**

Remove the `exec` and `getLogs` methods from the `dockerProvider` object. Keep `appendOutput`, `runExec`, `execOutputs`, `execOutputSize` — they are used internally by `setupContainer`.

- [ ] **Step 3: Update `src/server/agents.ts`**

Remove `execAgent` and `getAgentLogs` server functions:

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
```

- [ ] **Step 4: Verify clean build**

Run: `npx tsc --noEmit`
Expected: No type errors.

Run: `npm run test`
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/provider.ts src/server/docker-provider.ts src/server/agents.ts
git commit -m "refactor: remove polling-based terminal code, clean provider interface"
```
