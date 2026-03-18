import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { getAgent, stopAgent, removeAgent, redeployAgent, checkAgentHealth, checkDirtyState } from "~/server/agents";
import { ConfirmModal } from "~/components/confirm-modal";
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
  const [dirtyConfirm, setDirtyConfirm] = useState<{ action: string; summary: string; onConfirm: () => void } | null>(null);

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

  const withDirtyCheck = useCallback(async (action: string, onConfirm: () => void) => {
    try {
      const { dirty, summary } = await checkDirtyState({ data: name });
      if (dirty) {
        setDirtyConfirm({ action, summary, onConfirm });
        return;
      }
    } catch {
      // Can't check — proceed without warning
    }
    onConfirm();
  }, [name]);

  const handleRedeploy = async () => {
    withDirtyCheck("redeploy", async () => {
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
    });
  };

  const handleRemove = async () => {
    withDirtyCheck("remove", async () => {
      try {
        await removeAgent({ data: name });
        navigate({ to: "/" });
      } catch (e) {
        setError(toErrorMessage(e));
      }
    });
  };

  return (
    <div className="px-3 pt-2 pb-1 flex flex-col h-[calc(100vh-49px)] overflow-hidden">
      {/* Header — single line with all actions */}
      <div className="flex items-center justify-between mb-1 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: "/" })}
            className="text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer"
          >
            &larr;
          </button>
          <span className="text-sm font-bold">{agent.name}</span>
          <StatusBadge status={agent.status} />
          {agent.status === "busy" && agent.busySince && (
            <span className="text-amber-400 text-xs tabular-nums">
              {Math.floor((Date.now() - new Date(agent.busySince).getTime()) / 60000)}m
            </span>
          )}
          {health && (
            <button
              onClick={() => setShowHealth(!showHealth)}
              className={`text-xs cursor-pointer ${
                !health.running ? "text-zinc-600 hover:text-zinc-400"
                : health.user === "dev" && health.git && health.node
                  ? "text-green-500 hover:text-green-400"
                  : "text-red-400 hover:text-red-300"
              }`}
            >
              {!health.running ? "\u25cb" : health.user === "dev" && health.git && health.node ? "\u2713" : "\u2717"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {agent.previewUrl && (
            <a
              href={resolvePreviewUrl(agent.previewUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
            >
              preview
            </a>
          )}
          {agent.status === "busy" && (
            <button
              onClick={handleStop}
              className="px-2 py-1 text-zinc-500 hover:text-zinc-300 text-xs transition-colors cursor-pointer"
            >
              stop
            </button>
          )}
          <button
            onClick={handleRedeploy}
            disabled={redeploying}
            className="px-2 py-1 text-zinc-500 hover:text-zinc-300 disabled:opacity-50 text-xs transition-colors cursor-pointer"
          >
            {redeploying ? "redeploying..." : "redeploy"}
          </button>
          <button
            onClick={handleRemove}
            className="px-2 py-1 text-red-400/60 hover:text-red-300 text-xs transition-colors cursor-pointer"
          >
            remove
          </button>
        </div>
      </div>

      {showHealth && health && <HealthBadge health={health} showHealth={true} onToggle={() => setShowHealth(false)} />}

      {error && (
        <p className="text-red-400 text-xs mb-1">Error: {error}</p>
      )}

      {agent.status === "error" && agent.errorMessage && (
        <div className="bg-red-950/50 border border-red-900 rounded px-3 py-2 mb-1">
          <p className="text-red-400 text-xs font-bold mb-1">Setup failed</p>
          <pre className="text-red-300 text-xs whitespace-pre-wrap break-words">{agent.errorMessage}</pre>
        </div>
      )}

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

      {dirtyConfirm && (
        <ConfirmModal
          title="Uncommitted changes"
          message={`This agent has ${dirtyConfirm.summary}. Are you sure you want to ${dirtyConfirm.action}? Uncommitted changes will be lost.`}
          confirmLabel={dirtyConfirm.action.charAt(0).toUpperCase() + dirtyConfirm.action.slice(1)}
          onConfirm={() => { setDirtyConfirm(null); dirtyConfirm.onConfirm(); }}
          onCancel={() => setDirtyConfirm(null)}
        />
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
