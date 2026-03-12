import { Link } from "@tanstack/react-router";
import type { Agent } from "~/lib/types";
import { StatusBadge } from "./status-badge";

export function AgentCard({ agent, projectName }: { agent: Agent; projectName?: string }) {
  return (
    <Link
      to="/agent/$name"
      params={{ name: agent.name }}
      className="block border border-zinc-800 rounded-lg p-4 hover:border-zinc-600 transition-colors bg-zinc-900"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium truncate">{agent.name}</span>
        <StatusBadge status={agent.status} />
      </div>
      {projectName && (
        <p className="text-xs text-zinc-500 truncate">{projectName}</p>
      )}
      <p className="text-xs text-zinc-600 mt-2">
        {new Date(agent.createdAt).toLocaleTimeString()}
      </p>
    </Link>
  );
}
