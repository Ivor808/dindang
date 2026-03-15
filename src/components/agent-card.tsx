import { Link } from "@tanstack/react-router";
import type { Agent } from "~/lib/types";
import { StatusBadge } from "./status-badge";

export function AgentCard({ agent, projectName }: { agent: Agent; projectName?: string }) {
  const isProvisioning = agent.status === "provisioning";

  const content = (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium truncate">{agent.name}</span>
        <StatusBadge status={agent.status} />
      </div>
      {projectName && (
        <p className="text-xs text-zinc-500 truncate">{projectName}</p>
      )}
      {agent.status === "error" && agent.errorMessage && (
        <p className="text-xs text-red-400 mt-1 truncate" title={agent.errorMessage}>
          {agent.errorMessage}
        </p>
      )}
      <p className="text-xs text-zinc-600 mt-2">
        {isProvisioning ? (
          <span className="text-zinc-400 animate-pulse">setting up...</span>
        ) : (
          new Date(agent.createdAt).toLocaleTimeString()
        )}
      </p>
    </>
  );

  if (isProvisioning) {
    return (
      <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900 opacity-70 cursor-not-allowed">
        {content}
      </div>
    );
  }

  return (
    <Link
      to="/agent/$name"
      params={{ name: agent.name }}
      className="block border border-zinc-800 rounded-lg p-4 hover:border-zinc-600 transition-colors bg-zinc-900"
    >
      {content}
    </Link>
  );
}
