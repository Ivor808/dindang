import { useState, useRef, useEffect, memo } from "react";
import { Link } from "@tanstack/react-router";
import type { Agent } from "~/lib/types";
import type { AiCli } from "~/lib/types";
import { StatusBadge } from "./status-badge";

const COLORS = [
  null,
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];

function ClaudeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="#D97757" className="shrink-0">
      <path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/>
    </svg>
  );
}

function CodexIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#059669" fillOpacity="0.2" stroke="#059669" strokeWidth="1.5"/>
      <path d="M8 12h8M12 8v8" stroke="#059669" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function CliIcon({ cli }: { cli?: AiCli }) {
  if (cli === "claude") return <ClaudeIcon />;
  if (cli === "codex") return <CodexIcon />;
  return null;
}

const BusyTimer = memo(function BusyTimer({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - new Date(since).getTime()) / 1000));

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(since).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [since]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const display = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <span className="text-amber-400 text-xs tabular-nums">{display}</span>
  );
});

export function AgentCard({
  agent,
  projectName,
  aiCli,
  onRemove,
  onRedeploy,
  onRename,
  onColorChange,
}: {
  agent: Agent;
  projectName?: string;
  aiCli?: AiCli;
  onRemove?: () => void;
  onRedeploy?: () => void;
  onRename?: (newName: string) => void;
  onColorChange?: (color: string | null) => void;
}) {
  const isProvisioning = agent.status === "provisioning";
  const isBusy = agent.status === "busy";
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(agent.name);
  const [showColors, setShowColors] = useState(false);
  const colorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showColors) return;
    const handler = (e: MouseEvent) => {
      if (colorRef.current && !colorRef.current.contains(e.target as Node)) {
        setShowColors(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showColors]);

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== agent.name && onRename) {
      onRename(trimmed);
    }
    setEditing(false);
  };

  const borderStyle = agent.color
    ? { borderColor: agent.color, borderLeftWidth: "3px" }
    : undefined;

  if (isProvisioning) {
    return (
      <div
        className="border border-zinc-800 rounded-lg p-4 bg-zinc-900 opacity-70 cursor-not-allowed"
        style={borderStyle}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium truncate">{agent.name}</span>
          <StatusBadge status={agent.status} />
        </div>
        {projectName && <p className="text-xs text-zinc-500 truncate">{projectName}</p>}
        <p className="text-xs text-zinc-600 mt-2">
          <span className="text-zinc-400 animate-pulse">setting up...</span>
        </p>
      </div>
    );
  }

  return (
    <div
      className="group relative border border-zinc-800 rounded-lg bg-zinc-900 hover:border-zinc-600 transition-colors"
      style={borderStyle}
    >
      {aiCli && aiCli !== "none" && (
        <div className="absolute bottom-3 right-3 group-hover:opacity-0 transition-opacity pointer-events-none">
          <CliIcon cli={aiCli} />
        </div>
      )}
      <Link to="/agent/$name" params={{ name: agent.name }} className="block p-4">
        <div className="flex items-center justify-between mb-2">
          {editing ? (
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") { setEditName(agent.name); setEditing(false); }
              }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className="font-medium bg-transparent border-b border-zinc-500 outline-none text-sm w-full mr-2"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-1.5 truncate">
              {isBusy && (
                <svg className="animate-spin h-3 w-3 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              <span
                className="font-medium truncate cursor-text"
                onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditName(agent.name); setEditing(true); }}
              >
                {agent.name}
              </span>
            </div>
          )}
          <StatusBadge status={agent.status} />
        </div>
        {projectName && <p className="text-xs text-zinc-500 truncate">{projectName}</p>}
        {agent.status === "error" && agent.errorMessage && (
          <p className="text-xs text-red-400 mt-1 truncate" title={agent.errorMessage}>
            {agent.errorMessage}
          </p>
        )}
        <p className="text-xs text-zinc-600 mt-2 group-hover:invisible">
          {isBusy && agent.busySince ? (
            <BusyTimer since={agent.busySince} />
          ) : (
            new Date(agent.createdAt).toLocaleTimeString()
          )}
        </p>
      </Link>
      {/* Quick actions */}
      <div className="absolute bottom-0 left-0 right-0 px-4 pb-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {onRedeploy && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRedeploy(); }}
            className="text-xs text-zinc-500 hover:text-zinc-200 cursor-pointer"
          >
            redeploy
          </button>
        )}
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditName(agent.name); setEditing(true); }}
          className="text-xs text-zinc-500 hover:text-zinc-200 cursor-pointer"
        >
          rename
        </button>
        <div className="relative" ref={colorRef}>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowColors(!showColors); }}
            className="text-xs text-zinc-500 hover:text-zinc-200 cursor-pointer flex items-center gap-1"
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-full border border-zinc-600"
              style={{ backgroundColor: agent.color ?? "transparent" }}
            />
            color
          </button>
          {showColors && (
            <div
              className="absolute bottom-6 left-0 bg-zinc-800 border border-zinc-700 rounded-lg p-1.5 flex gap-1 z-20 shadow-lg"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            >
              {COLORS.map((c) => (
                <button
                  key={c ?? "none"}
                  onClick={() => { onColorChange?.(c); setShowColors(false); }}
                  className={`w-5 h-5 rounded-full border cursor-pointer transition-transform hover:scale-110 ${
                    c === agent.color || (!c && !agent.color) ? "border-white scale-110" : "border-zinc-600"
                  }`}
                  style={{ backgroundColor: c ?? "transparent" }}
                  title={c ?? "No color"}
                />
              ))}
            </div>
          )}
        </div>
        {onRemove && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
            className="text-xs text-red-400/70 hover:text-red-300 cursor-pointer ml-auto"
          >
            remove
          </button>
        )}
      </div>
    </div>
  );
}
