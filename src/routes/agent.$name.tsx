import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { getAgent, stopAgent, removeAgent, redeployAgent, checkAgentHealth } from "~/server/agents";
import type { AgentHealth } from "~/server/agents";
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

/** Replace 127.0.0.1/localhost in preview URLs with the current browser hostname */
function resolvePreviewUrl(url: string): string {
  if (url.startsWith("/")) return url; // relative proxy path, keep as-is
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
      parsed.hostname = window.location.hostname;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function AgentDetail() {
  const initialAgent = Route.useLoaderData();
  const { name } = Route.useParams();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent>(initialAgent);
  const [error, setError] = useState<string | null>(null);
  const [redeploying, setRedeploying] = useState(false);
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [showHealth, setShowHealth] = useState(false);

  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch health when agent becomes ready
  useEffect(() => {
    if (agent.status !== "ready" && agent.status !== "busy") return;
    checkAgentHealth({ data: name }).then(setHealth).catch(() => {});
  }, [agent.status, name]);

  // Poll agent status for header
  useEffect(() => {
    const interval = setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const updated = await getAgent({ data: name });
        setAgent((prev) =>
          prev.status === updated.status && prev.hostPort === updated.hostPort
            ? prev
            : updated
        );
      } catch {
        // container may have been removed
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [name]);

  // Initialize xterm + connect/reconnect WebSocket
  useEffect(() => {
    if (!termContainerRef.current || agent.status === "provisioning") return;

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

    // Connect WebSocket — server keeps PTY alive across reconnects
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/terminal/${name}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event) => {
      const data = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : event.data;
      term.write(data);
    };

    ws.onclose = () => {
      // Don't print anything — the session is still alive server-side.
      // User will reconnect on next visit.
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

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(termContainerRef.current);

    term.focus();

    return () => {
      resizeObserver.disconnect();
      ws.close(); // detaches from server session but PTY stays alive
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- status gate: only need to wait for non-provisioning
  }, [name, agent.status === "provisioning"]);

  const handleStop = async () => {
    try {
      wsRef.current?.close();
      await stopAgent({ data: name });
      navigate({ to: "/" });
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const handleRedeploy = async () => {
    setRedeploying(true);
    setError(null);
    try {
      wsRef.current?.close();
      const updated = await redeployAgent({ data: name });
      setAgent(updated);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setRedeploying(false);
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
        <div className="flex items-center gap-2">
          {agent.previewUrl && (
            <a
              href={resolvePreviewUrl(agent.previewUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors"
            >
              preview
            </a>
          )}
          {agent.status === "busy" && (
            <button
              onClick={handleStop}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors cursor-pointer"
            >
              stop
            </button>
          )}
          <button
            onClick={handleRedeploy}
            disabled={redeploying}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
          >
            {redeploying ? "redeploying..." : "redeploy"}
          </button>
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

      {agent.status === "error" && agent.errorMessage && (
        <div className="bg-red-950/50 border border-red-900 rounded px-4 py-3 mb-3">
          <p className="text-red-400 text-xs font-bold mb-1">Setup failed</p>
          <pre className="text-red-300 text-xs whitespace-pre-wrap break-words">{agent.errorMessage}</pre>
        </div>
      )}

      {health && health.running && <HealthBadge health={health} showHealth={showHealth} onToggle={() => setShowHealth(!showHealth)} />}

      {/* Terminal */}
      <div className="flex-1 bg-black rounded-lg border border-zinc-800 flex flex-col min-h-0 overflow-hidden relative">
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

        {redeploying && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center">
            <div className="flex items-center gap-3 text-zinc-400 text-sm">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Redeploying container...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HealthBadge({ health, showHealth, onToggle }: { health: AgentHealth; showHealth: boolean; onToggle: () => void }) {
  const checks = [
    { label: "user", ok: health.user === "dev", detail: health.user ?? "none" },
    { label: "git", ok: health.git },
    { label: "curl", ok: health.curl },
    { label: "node", ok: health.node },
    ...(health.aiCli ? [{ label: health.aiCli.name, ok: health.aiCli.installed }] : []),
    { label: "workdir", ok: health.workDirExists },
  ];
  const allOk = checks.every((c) => c.ok);

  return (
    <div className="mb-3">
      <button
        onClick={onToggle}
        className={`text-xs px-2 py-1 rounded cursor-pointer transition-colors ${
          allOk
            ? "bg-green-900/50 text-green-400 hover:bg-green-900/70"
            : "bg-red-900/50 text-red-400 hover:bg-red-900/70"
        }`}
      >
        {allOk ? "\u2713 healthy" : "\u2717 unhealthy"}
      </button>
      {showHealth && (
        <div className="flex items-center gap-3 mt-2 text-xs">
          {checks.map(({ label, ok, detail }) => (
            <span key={label} className={ok ? "text-green-500" : "text-red-400"}>
              {ok ? "\u2713" : "\u2717"} {label}{detail ? ` (${detail})` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
