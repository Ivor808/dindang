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

export function allocateSession(layout: AgentTerminalLayout): { sessionName: string; nextSessionNum: number } {
  return {
    sessionName: `term-${layout.nextSessionNum}`,
    nextSessionNum: layout.nextSessionNum + 1,
  };
}

export function allSessions(layout: AgentTerminalLayout): string[] {
  return layout.tabs.flatMap((t) => t.sessions);
}
