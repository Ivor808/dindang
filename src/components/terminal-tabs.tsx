import { useState, useEffect, useCallback } from "react";
import { TerminalPane, sendKillSession, sendSyncSessions } from "./terminal-pane";
import {
  getLayout, saveLayout, allocateSession, allSessions, uid,
  type AgentTerminalLayout, type TerminalTab,
} from "~/lib/terminal-layout";

interface TerminalTabsProps {
  agentName: string;
  disabled?: boolean;
}

export function TerminalTabs({ agentName, disabled }: TerminalTabsProps) {
  const [layout, setLayout] = useState<AgentTerminalLayout>(() => getLayout(agentName));
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Persist layout on change (debounced to avoid localStorage thrashing)
  useEffect(() => {
    const timeout = setTimeout(() => saveLayout(agentName, layout), 300);
    return () => clearTimeout(timeout);
  }, [agentName, layout]);

  // Sync sessions on mount (cleanup orphans)
  useEffect(() => {
    const sessions = allSessions(layout);
    if (sessions.length > 0) {
      sendSyncSessions(agentName, sessions);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, [agentName]);

  const activeTab = layout.tabs.find((t) => t.id === layout.activeTabId) ?? layout.tabs[0]!;

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input (e.g., tab rename)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const isMac = navigator.platform.startsWith("Mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      // Cmd/Ctrl+T — new tab
      if (e.key === "t") {
        e.preventDefault();
        addTab();
        return;
      }
      // Cmd/Ctrl+W — close current tab
      if (e.key === "w") {
        e.preventDefault();
        if (layout.tabs.length > 1) closeTab(layout.activeTabId);
        return;
      }
      // Cmd/Ctrl+\ — toggle split
      if (e.key === "\\") {
        e.preventDefault();
        toggleSplit();
        return;
      }
      // Cmd/Ctrl+1-9 — switch to tab by number
      if (e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < layout.tabs.length) {
          updateLayout((prev) => ({ ...prev, activeTabId: prev.tabs[idx]!.id }));
        }
        return;
      }
      // Cmd/Ctrl+Shift+[ or ] — previous/next tab
      if (e.shiftKey && (e.key === "[" || e.key === "{")) {
        e.preventDefault();
        const idx = layout.tabs.findIndex((t) => t.id === layout.activeTabId);
        const prev = (idx - 1 + layout.tabs.length) % layout.tabs.length;
        updateLayout((p) => ({ ...p, activeTabId: p.tabs[prev]!.id }));
        return;
      }
      if (e.shiftKey && (e.key === "]" || e.key === "}")) {
        e.preventDefault();
        const idx = layout.tabs.findIndex((t) => t.id === layout.activeTabId);
        const next = (idx + 1) % layout.tabs.length;
        updateLayout((p) => ({ ...p, activeTabId: p.tabs[next]!.id }));
        return;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [layout.activeTabId, layout.tabs.length]);

  const updateLayout = useCallback((fn: (prev: AgentTerminalLayout) => AgentTerminalLayout) => {
    setLayout((prev) => fn(prev));
  }, []);

  const addTab = () => {
    updateLayout((prev) => {
      const { sessionName, nextSessionNum } = allocateSession(prev);
      const id = uid();
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
        const { sessionName, nextSessionNum } = allocateSession(prev);
        return {
          ...prev,
          nextSessionNum,
          tabs: prev.tabs.map((t) =>
            t.id === tab.id
              ? { ...t, split: "horizontal" as const, sessions: [t.sessions[0], sessionName] as [string, string] }
              : t
          ),
        };
      } else {
        const secondSession = tab.sessions[1];
        if (secondSession) sendKillSession(agentName, secondSession);
        return {
          ...prev,
          tabs: prev.tabs.map((t) =>
            t.id === tab.id
              ? { ...t, split: "none" as const, sessions: [t.sessions[0]] as [string] }
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
          ? { ...t, split: t.split === "horizontal" ? "vertical" as const : "horizontal" as const }
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
            className={`group flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r border-zinc-800 shrink-0 ${
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditingTabId(null);
                }}
                className="bg-transparent border-b border-zinc-500 outline-none text-xs w-16"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span>{tab.name}</span>
                {tab.id === layout.activeTabId && (
                  <button
                    onClick={(e) => { e.stopPropagation(); startRename(tab); }}
                    className="text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Rename tab"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                  </button>
                )}
              </>
            )}
            {layout.tabs.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="text-zinc-600 hover:text-zinc-300 ml-1"
              >
                &times;
              </button>
            )}
          </div>
        ))}
        <button onClick={addTab} className="px-2 py-1.5 text-xs text-zinc-600 hover:text-zinc-300 shrink-0 cursor-pointer">
          +
        </button>
        {/* Split controls */}
        <div className="ml-auto flex items-center gap-1 px-2">
          <button
            onClick={toggleSplit}
            className="text-xs text-zinc-600 hover:text-zinc-300 px-1 cursor-pointer"
            title={activeTab.split === "none" ? "Split pane" : "Close split"}
          >
            {activeTab.split === "none" ? "\u229e" : "\u229f"}
          </button>
          {activeTab.split !== "none" && (
            <button
              onClick={toggleDirection}
              className="text-xs text-zinc-600 hover:text-zinc-300 px-1 cursor-pointer"
              title={activeTab.split === "horizontal" ? "Switch to vertical" : "Switch to horizontal"}
            >
              {activeTab.split === "horizontal" ? "\u2b0d" : "\u2b0c"}
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
