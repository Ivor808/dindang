import { createFileRoute, useRouter, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  getAgent,
  startAgent,
  stopAgent,
  removeAgent,
  getAgentLogs,
} from "~/server/agents";
import { StatusBadge } from "~/components/status-badge";
import { LogViewer } from "~/components/log-viewer";
import type { Agent } from "~/lib/types";

export const Route = createFileRoute("/agent/$name")({
  loader: ({ params }) => getAgent({ data: params.name }),
  component: AgentDetail,
});

function AgentDetail() {
  const initialAgent = Route.useLoaderData();
  const { name } = Route.useParams();
  const navigate = useNavigate();
  const [command, setCommand] = useState("");
  const [logs, setLogs] = useState("");
  const [agent, setAgent] = useState<Agent>(initialAgent);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const [status, logText] = await Promise.all([
        getAgent({ data: name }),
        getAgentLogs({ data: name }),
      ]);
      setAgent(status);
      setLogs(logText);

      // Stop polling when container is no longer running
      if (status.status !== "running" && pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    } catch {
      // Container may have been removed
    }
  }, [name]);

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    poll();
    pollingRef.current = setInterval(poll, 2000);
  }, [poll]);

  useEffect(() => {
    if (agent.status === "running") {
      startPolling();
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [agent.status, startPolling]);

  const handleStart = async () => {
    if (!command.trim()) return;
    setLogs("");
    const updated = await startAgent({
      data: { name, command: command.trim() },
    });
    setAgent(updated);
    startPolling();
  };

  const handleStop = async () => {
    const updated = await stopAgent({ data: name });
    setAgent(updated);
  };

  const handleRemove = async () => {
    await removeAgent({ data: name });
    navigate({ to: "/" });
  };

  const logLines = logs ? logs.split("\n") : [];

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate({ to: "/" })}
          className="text-zinc-500 hover:text-zinc-300 text-sm cursor-pointer"
        >
          &larr; back
        </button>
        <h1 className="text-xl font-bold">{agent.name}</h1>
        <StatusBadge status={agent.status} />
      </div>

      {/* Command input */}
      <div className="mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleStart()}
            placeholder='echo "hello world" && sleep 5 && echo "done"'
            className="flex-1 bg-black border border-zinc-800 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-zinc-600"
            disabled={agent.status === "running"}
          />
          <button
            onClick={handleStart}
            disabled={agent.status === "running" || !command.trim()}
            className="px-4 py-2 bg-blue-900 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm transition-colors cursor-pointer"
          >
            run
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mb-4">
        {agent.status === "running" && (
          <button
            onClick={handleStop}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-sm transition-colors cursor-pointer"
          >
            stop
          </button>
        )}
        <button
          onClick={handleRemove}
          className="px-3 py-1.5 bg-red-950 hover:bg-red-900 text-red-300 rounded text-sm transition-colors cursor-pointer"
        >
          remove
        </button>
      </div>

      {/* Logs */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm text-zinc-500">output</span>
          {agent.status === "running" && (
            <span className="text-xs text-blue-400 animate-pulse">
              streaming...
            </span>
          )}
        </div>
        <LogViewer lines={logLines} />
      </div>
    </div>
  );
}
