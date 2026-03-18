import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

function wsUrl(agentName: string, sessionName: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/terminal/${agentName}/${sessionName}`;
}

interface TerminalPaneProps {
  agentName: string;
  sessionName: string;
  active: boolean;
}

export function TerminalPane({ agentName, sessionName, active }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

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
      scrollback: 10000,
      altClickMovesCursor: false,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const ws = new WebSocket(wsUrl(agentName, sessionName));
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
    if (active) {
      // Small delay to let the DOM update before measuring
      const id = requestAnimationFrame(() => fitRef.current?.fit());
      return () => cancelAnimationFrame(id);
    }
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 min-w-0 p-1 overscroll-contain"
    />
  );
}

/** Send a kill-session control message via a temporary WebSocket */
export function sendKillSession(agentName: string, sessionName: string): void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(
    `${protocol}//${window.location.host}/ws/terminal/${agentName}/${sessionName}`
  );
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "kill-session", sessionName }));
    ws.close();
  };
  ws.onerror = () => ws.close();
}

/** Send a sync-sessions message to clean up orphaned tmux sessions */
export function sendSyncSessions(agentName: string, sessions: string[]): void {
  if (sessions.length === 0) return;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(
    `${protocol}//${window.location.host}/ws/terminal/${agentName}/${sessions[0]}`
  );
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "sync-sessions", sessions }));
    ws.close();
  };
  ws.onerror = () => ws.close();
}
