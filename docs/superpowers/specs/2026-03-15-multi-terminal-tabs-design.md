# Multi-Terminal Tabs — Design Spec

**Date:** 2026-03-15

## Summary

Add tabbed multi-terminal support to the agent detail page. Users can create named tabs, each containing one or two terminal panes (optional split). Each pane connects to an independent tmux session inside the agent container. Layout persists in localStorage.

## Data Model

```ts
interface TerminalTab {
  id: string;        // unique id (crypto.randomUUID)
  name: string;      // user-editable label
  split: "none" | "horizontal" | "vertical";
  sessions: [string] | [string, string]; // tmux session names, e.g. ["term-1"] or ["term-1", "term-2"]
}

interface AgentTerminalLayout {
  tabs: TerminalTab[];
  activeTabId: string;
  nextSessionNum: number; // monotonically increasing for term-N naming
}
```

**Storage key:** `dindang:terminal-layout:{agentName}`

**Default layout:** One tab named "terminal", `split: "none"`, session `["term-1"]`.

## WebSocket Changes

Route changes from `/ws/terminal/{agentName}` to `/ws/terminal/{agentName}/{sessionName}`.

Server handler passes `sessionName` to `openPTY`. The tmux command becomes:

```
tmux has-session -t {sessionName} 2>/dev/null && tmux attach-session -dt {sessionName} || tmux new-session -s {sessionName} -c '{cwd}'
```

## UI Components

### Tab Bar

- Horizontal row between header and terminal area
- Active tab highlighted
- Double-click tab name to rename (inline edit)
- "+" button to add new tab
- "x" on each tab to close (kills tmux session(s), minimum 1 tab enforced)

### Terminal Area

- **No split:** Single xterm instance filling the space
- **Split:** Two xterm instances, 50/50 fixed ratio, horizontal (side-by-side) or vertical (top/bottom)
- Split controls in the terminal header bar: button to split/unsplit, button to toggle split direction

### Each Pane

- Independent xterm.js instance
- Independent WebSocket connection to `/ws/terminal/{agentName}/{sessionName}`
- Independent tmux session (`term-1`, `term-2`, etc.)

## Session Lifecycle

- **Creating a tab:** Allocates session name(s) from `nextSessionNum` counter. tmux session created on first WebSocket connect.
- **Closing a tab:** Kills the tmux session(s) via a new WebSocket message or API call, then closes WebSocket(s). Cannot close the last tab.
- **Split → unsplit:** Kills the second tmux session, closes its WebSocket.
- **Unsplit → split:** Allocates a new session name, opens new WebSocket + xterm instance.

## Session Cleanup

When a tab is closed, the server kills the associated tmux session(s) inside the container (`tmux kill-session -t {sessionName}`). This ensures no orphaned sessions accumulate.

Implementation options for the kill:
1. Send a control message over the existing WebSocket before closing (e.g., `{ type: "kill-session" }`)
2. New HTTP endpoint `POST /api/terminal/{agentName}/{sessionName}/kill`

Option 1 is simpler — no new endpoint needed.

## Persistence

Layout saved to `localStorage` on every change (tab create/close/rename, split toggle). Restored on page load. If localStorage has no entry, use default layout.

Stale layouts (agent removed and recreated) are self-healing: tmux sessions that don't exist get created fresh on connect.

## No DB Changes

All state is client-side (localStorage + tmux sessions inside containers). No schema changes, no migrations.

## Scope Exclusions

- No draggable pane resize (fixed 50/50)
- No drag-to-reorder tabs
- No more than 2 panes per tab
- No sharing layout across devices/browsers
