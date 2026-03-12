import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  getAgent,
  execAgent,
  stopAgent,
  removeAgent,
  getAgentLogs,
} from "~/server/agents";
import { StatusBadge } from "~/components/status-badge";
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
  const [agent, setAgent] = useState<Agent>(initialAgent);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  // Terminal buffer — accumulated lines that never get wiped
  const [termLines, setTermLines] = useState<string[]>([]);
  // Track how much Docker log content we've already consumed
  const lastLogLenRef = useRef(0);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [termLines]);

  const poll = useCallback(async () => {
    try {
      const [status, logText] = await Promise.all([
        getAgent({ data: name }),
        getAgentLogs({ data: name }),
      ]);
      setAgent(status);

      // Only append new log content since last poll
      if (logText.length > lastLogLenRef.current) {
        const newContent = logText.slice(lastLogLenRef.current);
        lastLogLenRef.current = logText.length;
        const newLines = newContent.split("\n").filter((l) => l.length > 0);
        if (newLines.length > 0) {
          setTermLines((prev) => [...prev, ...newLines]);
        }
      }
    } catch {
      // container may have been removed
    }
  }, [name]);

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    poll();
    pollingRef.current = setInterval(poll, 2000);
  }, [poll]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Fetch initial logs on mount
    (async () => {
      try {
        const logText = await getAgentLogs({ data: name });
        lastLogLenRef.current = logText.length;
      } catch {
        // ignore
      }
    })();
    return stopPolling;
  }, [name, stopPolling]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (!command.trim() || executing) return;
    const cmd = command.trim();
    setCmdHistory((prev) => [...prev, cmd]);
    setHistoryIdx(-1);
    setCommand("");
    // Echo the command into the terminal buffer
    setTermLines((prev) => [...prev, `$ ${cmd}`]);
    setError(null);
    setExecuting(true);
    try {
      await execAgent({ data: { name, command: cmd } });
      // Start polling to pick up output
      startPolling();
      // Keep polling for a while, then stop and re-enable input
      setTimeout(() => {
        poll().then(() => {
          setExecuting(false);
          inputRef.current?.focus();
        });
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setExecuting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      const next =
        historyIdx === -1
          ? cmdHistory.length - 1
          : Math.max(0, historyIdx - 1);
      setHistoryIdx(next);
      setCommand(cmdHistory[next]!);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx === -1) return;
      const next = historyIdx + 1;
      if (next >= cmdHistory.length) {
        setHistoryIdx(-1);
        setCommand("");
      } else {
        setHistoryIdx(next);
        setCommand(cmdHistory[next]!);
      }
    }
  };

  const handleStop = async () => {
    try {
      const updated = await stopAgent({ data: name });
      setAgent(updated);
      stopPolling();
      setExecuting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRemove = async () => {
    try {
      stopPolling();
      await removeAgent({ data: name });
      navigate({ to: "/" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 flex flex-col h-screen">
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
        <div className="flex gap-2">
          {agent.status === "busy" && (
            <button
              onClick={handleStop}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors cursor-pointer"
            >
              stop
            </button>
          )}
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

      {/* Terminal */}
      <div
        className="flex-1 bg-black rounded-lg border border-zinc-800 flex flex-col min-h-0 overflow-hidden cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <span className="text-xs text-zinc-500 ml-2">{agent.name}</span>
          {executing && (
            <span className="text-xs text-blue-400 animate-pulse ml-auto">
              executing...
            </span>
          )}
        </div>

        {/* Terminal body */}
        <div className="flex-1 overflow-y-auto p-4 text-sm text-zinc-300 font-mono">
          {termLines.map((line, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap break-all leading-relaxed ${
                line.startsWith("$ ") ? "text-green-400" : ""
              }`}
            >
              {line}
            </div>
          ))}

          {/* Prompt line */}
          <div className="flex items-center mt-1">
            <span className="text-green-400 shrink-0">$&nbsp;</span>
            <input
              ref={inputRef}
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              readOnly={executing}
              className={`flex-1 bg-transparent border-none outline-none font-mono text-sm caret-green-400 ${executing ? "text-zinc-600" : "text-zinc-100"}`}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
