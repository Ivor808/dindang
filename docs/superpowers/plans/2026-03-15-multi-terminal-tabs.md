# Multi-Terminal Tabs Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tabbed multi-terminal support to the agent detail page, where each tab can optionally split into two panes, each connected to an independent tmux session.

**Architecture:** Add a `sessionName` parameter to the WebSocket route and transport layer so each pane connects to a named tmux session. Extract terminal rendering into a reusable `TerminalPane` component. Build a `TerminalTabs` component that manages tab/split state in localStorage and renders the panes. Add control messages for session cleanup (kill-session, sync-sessions).

**Tech Stack:** React, xterm.js, WebSocket, tmux, localStorage

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/terminal-layout.ts` | Create | Layout types, localStorage persistence, default factory |
| `src/components/terminal-pane.tsx` | Create | Single xterm.js instance + WebSocket for one session |
| `src/components/terminal-tabs.tsx` | Create | Tab bar, split controls, layout state, renders panes |
| `src/routes/agent.$name.tsx` | Modify | Replace inline terminal with `<TerminalTabs>` |
| `src/lib/transport.ts` | Modify | Add `sessionName` to `PTYOptions` |
| `src/server/terminal.ts` | Modify | Parse sessionName from URL, handle kill/sync messages |
| `src/server/transports/docker.ts` | Modify | Use `sessionName` in tmux command |
| `src/server/transports/server.ts` | Modify | Use `sessionName` in tmux command |

---

## Chunk 1: Server — session-aware WebSocket

### Task 1: Add sessionName to PTYOptions and transport layer

**Files:**
- Modify: `src/lib/transport.ts:7-12`
- Modify: `src/server/transports/docker.ts:33-66`
- Modify: `src/server/transports/server.ts:28-42`

- [ ] **Step 1: Add `sessionName` to `PTYOptions`**

In `src/lib/transport.ts`, add `sessionName` field:

```ts
export interface PTYOptions {
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  cwd?: string;
  sessionName?: string;
}
```

- [ ] **Step 2: Update DockerTransport.openPTY to use sessionName**

In `src/server/transports/docker.ts`, replace hardcoded `main` with `options?.sessionName ?? "main"`:

```ts
async openPTY(options?: PTYOptions): Promise<PTYSession> {
  const cwd = options?.cwd ?? "/home/dev";
  const session = options?.sessionName ?? "main";
  const escapedSession = session.replace(/'/g, "'\\''");
  const tmuxCmd = `tmux has-session -t '${escapedSession}' 2>/dev/null && tmux attach-session -dt '${escapedSession}' || tmux new-session -s '${escapedSession}' -c '${cwd.replace(/'/g, "'\\''")}'`;
  // ... rest unchanged
```

- [ ] **Step 3: Update ServerTransport.openPTY to use sessionName**

In `src/server/transports/server.ts`, same change — replace hardcoded `main`:

```ts
async openPTY(options?: PTYOptions): Promise<PTYSession> {
  const pty = await this.ssh.openPTY({
    cols: options?.cols,
    rows: options?.rows,
  });
  const cwd = options?.cwd ?? "/home/dev";
  const session = options?.sessionName ?? "main";
  const tmuxCmd = `tmux has-session -t ${session} 2>/dev/null && tmux attach-session -dt ${session} || tmux new-session -s ${session} -c '${cwd}'`;
  pty.stream.write(`docker exec -it -u dev -w ${cwd} -e HOME=/home/dev -e PATH=/home/dev/.local/bin:/usr/local/bin:/usr/bin:/bin ${this.containerId} bash -lc '${tmuxCmd}'\n`);
  return pty;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/transport.ts src/server/transports/docker.ts src/server/transports/server.ts
git commit -m "feat: add sessionName to PTYOptions for multi-terminal support"
```

### Task 2: Update WebSocket handler to parse sessionName and handle control messages

**Files:**
- Modify: `src/server/terminal.ts`

- [ ] **Step 1: Update URL regex to capture sessionName**

Change the regex from `/^\/ws\/terminal\/(.+)$/` to `/^\/ws\/terminal\/([^/]+)\/([^/]+)$/` and pass both `agentName` and `sessionName` to `handleConnection`.

```ts
const TERMINAL_PATH_RE = /^\/ws\/terminal\/([^/]+)\/([^/]+)$/;

// In attachTerminalWebSocket:
const agentName = match[1]!;
const sessionName = match[2]!;
wss.handleUpgrade(req, socket, head, (ws) => {
  handleConnection(ws, agentName, sessionName);
});
```

- [ ] **Step 2: Pass sessionName to openPTY**

In `handleConnection`, pass `sessionName` through to `transport.openPTY`:

```ts
async function handleConnection(ws: WebSocket, agentName: string, sessionName: string): Promise<void> {
  // ... agent/machine lookup unchanged ...
  const pty = await transport.openPTY({
    cwd: cwdExists ? cwd : "/home/dev",
    sessionName,
  });
```

- [ ] **Step 3: Handle kill-session and sync-sessions control messages**

In the `ws.on("message")` handler, add new control message types:

```ts
if (ctrl.type === "kill-session" && ctrl.sessionName) {
  // Kill a tmux session inside the container
  await transport.exec(["runuser", "-l", "dev", "-c", `tmux kill-session -t '${ctrl.sessionName}' 2>/dev/null`]);
  return;
}
if (ctrl.type === "sync-sessions" && Array.isArray(ctrl.sessions)) {
  // List all tmux sessions, kill any not in the client's list
  const result = await transport.exec(["runuser", "-l", "dev", "-c", "tmux list-sessions -F '#{session_name}' 2>/dev/null"]);
  if (result.exitCode === 0) {
    const existing = result.stdout.trim().split("\n").filter(Boolean);
    const expected = new Set(ctrl.sessions as string[]);
    for (const s of existing) {
      if (!expected.has(s)) {
        await transport.exec(["runuser", "-l", "dev", "-c", `tmux kill-session -t '${s}' 2>/dev/null`]);
      }
    }
  }
  return;
}
```

Note: The `transport` variable needs to be accessible in the message handler scope. Currently it's created before the message handler, so it's already in scope. However, for kill-session and sync-sessions, we need a transport that isn't tied to the PTY. Store the `transport` reference in the closure.

- [ ] **Step 4: Commit**

```bash
git add src/server/terminal.ts
git commit -m "feat: session-aware WebSocket with kill/sync control messages"
```

---

## Chunk 2: Client — layout types and persistence

### Task 3: Create terminal layout types and localStorage persistence

**Files:**
- Create: `src/lib/terminal-layout.ts`

- [ ] **Step 1: Create the layout module**

```ts
export interface TerminalTab {
  id: string;
  name: string;
  split: "none" | "horizontal" | "vertical";
  sessions: [string] | [string, string];
}

export interface AgentTerminalLayout {
  tabs: TerminalTab[];
  activeTabId: string;
  nextSessionNum: number;
}

const STORAGE_PREFIX = "dindang:terminal-layout:";

export function getLayout(agentName: string): AgentTerminalLayout {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + agentName);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt data */ }
  return createDefaultLayout();
}

export function saveLayout(agentName: string, layout: AgentTerminalLayout): void {
  localStorage.setItem(STORAGE_PREFIX + agentName, JSON.stringify(layout));
}

export function createDefaultLayout(): AgentTerminalLayout {
  const id = crypto.randomUUID();
  return {
    tabs: [{ id, name: "terminal", split: "none", sessions: ["term-1"] }],
    activeTabId: id,
    nextSessionNum: 2,
  };
}

/** Allocate a new session name and bump the counter */
export function allocateSession(layout: AgentTerminalLayout): { sessionName: string; nextSessionNum: number } {
  return {
    sessionName: `term-${layout.nextSessionNum}`,
    nextSessionNum: layout.nextSessionNum + 1,
  };
}

/** Get all session names referenced by the layout */
export function allSessions(layout: AgentTerminalLayout): string[] {
  return layout.tabs.flatMap((t) => t.sessions);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/terminal-layout.ts
git commit -m "feat: terminal layout types and localStorage persistence"
```

---

## Chunk 3: Client — TerminalPane component

### Task 4: Extract terminal rendering into a reusable TerminalPane

**Files:**
- Create: `src/components/terminal-pane.tsx`

- [ ] **Step 1: Create TerminalPane component**

This component takes `agentName` and `sessionName` props, manages its own xterm instance and WebSocket connection.

```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

interface TerminalPaneProps {
  agentName: string;
  sessionName: string;
  active: boolean; // whether the tab containing this pane is active (for fit)
}

export function TerminalPane({ agentName, sessionName, active }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Create xterm + WebSocket
  useEffect(() => {
    if (!containerRef.current) return;

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
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/terminal/${agentName}/${sessionName}`
    );
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    ws.onmessage = (event) => {
      const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
      term.write(data);
    };
    ws.onerror = () => {
      term.write("\r\n\x1b[31m[connection error]\x1b[0m\r\n");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
    };
  }, [agentName, sessionName]);

  // Re-fit when tab becomes active (hidden tabs have 0 size)
  useEffect(() => {
    if (active) fitRef.current?.fit();
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 min-w-0 p-1"
      onClick={() => termRef.current?.focus()}
    />
  );
}

/** Send a kill-session control message to any open WebSocket for this agent */
export function sendKillSession(agentName: string, sessionName: string): void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(
    `${protocol}//${window.location.host}/ws/terminal/${agentName}/${sessionName}`
  );
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "kill-session", sessionName }));
    ws.close();
  };
}

/** Send a sync-sessions message to clean up orphaned tmux sessions */
export function sendSyncSessions(agentName: string, sessions: string[]): void {
  // Use the first session's WebSocket to send the sync
  if (sessions.length === 0) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(
    `${protocol}//${window.location.host}/ws/terminal/${agentName}/${sessions[0]}`
  );
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "sync-sessions", sessions }));
    ws.close();
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/terminal-pane.tsx
git commit -m "feat: reusable TerminalPane component with WebSocket per session"
```

---

## Chunk 4: Client — TerminalTabs component

### Task 5: Build TerminalTabs with tab bar, split controls, and layout management

**Files:**
- Create: `src/components/terminal-tabs.tsx`

- [ ] **Step 1: Create TerminalTabs component**

This is the main orchestrator. It manages layout state, renders the tab bar and terminal panes, and handles tab CRUD + split toggling.

```tsx
import { useState, useEffect, useCallback } from "react";
import { TerminalPane, sendKillSession, sendSyncSessions } from "./terminal-pane";
import {
  getLayout, saveLayout, allocateSession, allSessions,
  type AgentTerminalLayout, type TerminalTab,
} from "~/lib/terminal-layout";

interface TerminalTabsProps {
  agentName: string;
  disabled?: boolean; // true when provisioning
}

export function TerminalTabs({ agentName, disabled }: TerminalTabsProps) {
  const [layout, setLayout] = useState<AgentTerminalLayout>(() => getLayout(agentName));
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Persist layout on change
  useEffect(() => { saveLayout(agentName, layout); }, [agentName, layout]);

  // Sync sessions on mount (cleanup orphans)
  useEffect(() => {
    sendSyncSessions(agentName, allSessions(layout));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, [agentName]);

  const activeTab = layout.tabs.find((t) => t.id === layout.activeTabId) ?? layout.tabs[0]!;

  const updateLayout = useCallback((fn: (prev: AgentTerminalLayout) => AgentTerminalLayout) => {
    setLayout((prev) => fn(prev));
  }, []);

  const addTab = () => {
    updateLayout((prev) => {
      const { sessionName, nextSessionNum } = allocateSession(prev);
      const id = crypto.randomUUID();
      return {
        ...prev,
        nextSessionNum,
        tabs: [...prev.tabs, { id, name: `tab ${prev.tabs.length + 1}`, split: "none", sessions: [sessionName] }],
        activeTabId: id,
      };
    });
  };

  const closeTab = (tabId: string) => {
    const tab = layout.tabs.find((t) => t.id === tabId);
    if (!tab || layout.tabs.length <= 1) return;
    // Kill tmux sessions
    for (const s of tab.sessions) sendKillSession(agentName, s);
    updateLayout((prev) => {
      const remaining = prev.tabs.filter((t) => t.id !== tabId);
      return {
        ...prev,
        tabs: remaining,
        activeTabId: prev.activeTabId === tabId ? remaining[0]!.id : prev.activeTabId,
      };
    });
  };

  const toggleSplit = () => {
    updateLayout((prev) => {
      const tab = prev.tabs.find((t) => t.id === prev.activeTabId);
      if (!tab) return prev;

      if (tab.split === "none") {
        // Add split
        const { sessionName, nextSessionNum } = allocateSession(prev);
        return {
          ...prev,
          nextSessionNum,
          tabs: prev.tabs.map((t) =>
            t.id === tab.id
              ? { ...t, split: "horizontal", sessions: [t.sessions[0], sessionName] as [string, string] }
              : t
          ),
        };
      } else {
        // Remove split — kill second session
        const secondSession = tab.sessions[1];
        if (secondSession) sendKillSession(agentName, secondSession);
        return {
          ...prev,
          tabs: prev.tabs.map((t) =>
            t.id === tab.id
              ? { ...t, split: "none", sessions: [t.sessions[0]] as [string] }
              : t
          ),
        };
      }
    });
  };

  const toggleDirection = () => {
    updateLayout((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === prev.activeTabId && t.split !== "none"
          ? { ...t, split: t.split === "horizontal" ? "vertical" : "horizontal" }
          : t
      ),
    }));
  };

  const startRename = (tab: TerminalTab) => {
    setEditingTabId(tab.id);
    setEditName(tab.name);
  };

  const commitRename = () => {
    if (!editingTabId) return;
    updateLayout((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === editingTabId ? { ...t, name: editName.trim() || t.name } : t
      ),
    }));
    setEditingTabId(null);
  };

  if (disabled) return null;

  return (
    <div className="flex-1 bg-black rounded-lg border border-zinc-800 flex flex-col min-h-0 overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center border-b border-zinc-800 bg-zinc-900/50 shrink-0 overflow-x-auto">
        {layout.tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-zinc-800 shrink-0 ${
              tab.id === layout.activeTabId
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
            }`}
            onClick={() => updateLayout((prev) => ({ ...prev, activeTabId: tab.id }))}
            onDoubleClick={() => startRename(tab)}
          >
            {editingTabId === tab.id ? (
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingTabId(null); }}
                className="bg-transparent border-b border-zinc-500 outline-none text-xs w-16"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span>{tab.name}</span>
            )}
            {layout.tabs.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="text-zinc-600 hover:text-zinc-300 ml-1"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button onClick={addTab} className="px-2 py-1.5 text-xs text-zinc-600 hover:text-zinc-300 shrink-0">
          +
        </button>
        {/* Split controls — right aligned */}
        <div className="ml-auto flex items-center gap-1 px-2">
          <button
            onClick={toggleSplit}
            className="text-xs text-zinc-600 hover:text-zinc-300 px-1"
            title={activeTab.split === "none" ? "Split pane" : "Close split"}
          >
            {activeTab.split === "none" ? "⊞" : "⊟"}
          </button>
          {activeTab.split !== "none" && (
            <button
              onClick={toggleDirection}
              className="text-xs text-zinc-600 hover:text-zinc-300 px-1"
              title={activeTab.split === "horizontal" ? "Switch to vertical" : "Switch to horizontal"}
            >
              {activeTab.split === "horizontal" ? "⬍" : "⬌"}
            </button>
          )}
        </div>
      </div>

      {/* Terminal panes */}
      {layout.tabs.map((tab) => (
        <div
          key={tab.id}
          className={`flex-1 min-h-0 ${tab.id === layout.activeTabId ? "flex" : "hidden"} ${
            tab.split === "horizontal" ? "flex-row" : "flex-col"
          }`}
        >
          <TerminalPane
            agentName={agentName}
            sessionName={tab.sessions[0]}
            active={tab.id === layout.activeTabId}
          />
          {tab.split !== "none" && tab.sessions[1] && (
            <>
              <div className={tab.split === "horizontal" ? "w-px bg-zinc-800" : "h-px bg-zinc-800"} />
              <TerminalPane
                agentName={agentName}
                sessionName={tab.sessions[1]}
                active={tab.id === layout.activeTabId}
              />
            </>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/terminal-tabs.tsx
git commit -m "feat: TerminalTabs component with tab bar, split panes, and layout persistence"
```

---

## Chunk 5: Integration — wire into agent detail page

### Task 6: Replace inline terminal in agent detail page with TerminalTabs

**Files:**
- Modify: `src/routes/agent.$name.tsx`

- [ ] **Step 1: Remove old terminal code, add TerminalTabs**

Remove:
- The `termContainerRef`, `termRef`, `wsRef` refs
- The xterm/WebSocket `useEffect` (lines 69-145)
- The terminal section of the JSX (lines 243-273)
- The `Terminal` and `FitAddon` imports

Add:
- Import `TerminalTabs` from `~/components/terminal-tabs`
- Replace the terminal JSX section with `<TerminalTabs agentName={name} disabled={agent.status === "provisioning"} />`

Also update `handleStop` and `handleRemove` — they currently call `wsRef.current?.close()` which no longer exists. Remove those lines (the TerminalTabs component manages its own WebSocket lifecycle; when the component unmounts on navigation, cleanup happens automatically).

The resulting return JSX structure:

```tsx
return (
  <div className="max-w-5xl mx-auto p-6 flex flex-col h-screen">
    {/* Header — unchanged */}
    {/* Error display — unchanged */}
    {/* Health badge — unchanged */}

    {/* Terminal tabs */}
    <TerminalTabs agentName={name} disabled={agent.status === "provisioning"} />

    {redeploying && (
      <div className="absolute inset-0 bg-black/80 flex items-center justify-center rounded-lg">
        {/* ... spinner unchanged ... */}
      </div>
    )}
  </div>
);
```

- [ ] **Step 2: Remove xterm CSS import if no longer needed at route level**

The `import "@xterm/xterm/css/xterm.css"` should move to `terminal-pane.tsx` (it's already imported there via the xterm usage). Remove it from `agent.$name.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/agent.$name.tsx
git commit -m "feat: integrate TerminalTabs into agent detail page"
```

### Task 7: Smoke test

- [ ] **Step 1: Manual verification**

1. Start dev server: `./dx run`
2. Navigate to an agent detail page
3. Verify single terminal tab works (connects, can type)
4. Click "+" to add a second tab, verify it connects independently
5. Double-click tab name, rename it, verify it persists on refresh
6. Click split button, verify two panes appear side-by-side
7. Click direction toggle, verify vertical split
8. Click unsplit, verify second pane removed
9. Close a tab, verify it's removed and session is killed
10. Refresh page, verify layout restored from localStorage
11. Open a second browser tab to same agent, verify both connect

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "feat: multi-terminal tabs with split panes and session management"
```
