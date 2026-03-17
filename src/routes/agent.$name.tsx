import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getAgent, stopAgent, removeAgent, redeployAgent, checkAgentHealth } from "~/server/agents";
import type { AgentHealth } from "~/server/agents";
import { StatusBadge } from "~/components/status-badge";
import { TerminalTabs } from "~/components/terminal-tabs";
import type { Agent } from "~/lib/types";
import { toErrorMessage } from "~/lib/errors";

export const Route = createFileRoute("/agent/$name")({
  loader: ({ params }) => getAgent({ data: params.name }),
  component: AgentDetail,
});

/** Resolve preview URLs to use the browser's current hostname */
function resolvePreviewUrl(url: string): string {
  // Local Docker: __PREVIEW_PORT__<port> → use browser hostname with that port
  if (url.startsWith("__PREVIEW_PORT__")) {
    const port = url.replace("__PREVIEW_PORT__", "");
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }
  if (url.startsWith("/")) return url;
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

  const handleStop = async () => {
    try {
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

      {/* Terminal tabs */}
      <TerminalTabs agentName={name} disabled={agent.status === "provisioning"} />

      {redeploying && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center rounded-lg">
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
