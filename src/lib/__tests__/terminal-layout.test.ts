import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getLayout,
  saveLayout,
  createDefaultLayout,
  allocateSession,
  allSessions,
  uid,
  type AgentTerminalLayout,
} from "../terminal-layout";

// Mock localStorage
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
  clear: () => store.clear(),
});

beforeEach(() => store.clear());

describe("uid", () => {
  it("returns a non-empty string", () => {
    expect(uid()).toBeTruthy();
    expect(typeof uid()).toBe("string");
  });

  it("returns unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid()));
    expect(ids.size).toBe(100);
  });
});

describe("createDefaultLayout", () => {
  it("creates a layout with one tab named 'terminal'", () => {
    const layout = createDefaultLayout();
    expect(layout.tabs).toHaveLength(1);
    expect(layout.tabs[0]!.name).toBe("terminal");
    expect(layout.tabs[0]!.split).toBe("none");
    expect(layout.tabs[0]!.sessions).toEqual(["term-1"]);
  });

  it("sets activeTabId to the first tab", () => {
    const layout = createDefaultLayout();
    expect(layout.activeTabId).toBe(layout.tabs[0]!.id);
  });

  it("sets nextSessionNum to 2", () => {
    const layout = createDefaultLayout();
    expect(layout.nextSessionNum).toBe(2);
  });
});

describe("saveLayout / getLayout", () => {
  it("round-trips a layout through localStorage", () => {
    const layout = createDefaultLayout();
    saveLayout("test-agent", layout);
    const loaded = getLayout("test-agent");
    expect(loaded).toEqual(layout);
  });

  it("returns default layout when no saved data", () => {
    const layout = getLayout("nonexistent-agent");
    expect(layout.tabs).toHaveLength(1);
    expect(layout.tabs[0]!.name).toBe("terminal");
  });

  it("returns default layout when localStorage has corrupt data", () => {
    store.set("dindang:terminal-layout:bad-agent", "not json{{{");
    const layout = getLayout("bad-agent");
    expect(layout.tabs).toHaveLength(1);
  });
});

describe("allocateSession", () => {
  it("returns the next session name and incremented counter", () => {
    const layout = createDefaultLayout(); // nextSessionNum = 2
    const result = allocateSession(layout);
    expect(result.sessionName).toBe("term-2");
    expect(result.nextSessionNum).toBe(3);
  });

  it("increments monotonically", () => {
    let layout: AgentTerminalLayout = { tabs: [], activeTabId: "", nextSessionNum: 10 };
    const r1 = allocateSession(layout);
    expect(r1.sessionName).toBe("term-10");
    layout = { ...layout, nextSessionNum: r1.nextSessionNum };
    const r2 = allocateSession(layout);
    expect(r2.sessionName).toBe("term-11");
  });
});

describe("allSessions", () => {
  it("collects sessions from all tabs", () => {
    const layout: AgentTerminalLayout = {
      tabs: [
        { id: "a", name: "tab1", split: "none", sessions: ["term-1"] },
        { id: "b", name: "tab2", split: "horizontal", sessions: ["term-2", "term-3"] },
      ],
      activeTabId: "a",
      nextSessionNum: 4,
    };
    expect(allSessions(layout)).toEqual(["term-1", "term-2", "term-3"]);
  });

  it("returns empty array for no tabs", () => {
    const layout: AgentTerminalLayout = { tabs: [], activeTabId: "", nextSessionNum: 1 };
    expect(allSessions(layout)).toEqual([]);
  });
});
