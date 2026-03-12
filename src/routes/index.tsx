import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useState } from "react";
import { listAgents, createAgent } from "~/server/agents";
import { listProjects } from "~/server/settings";
import { AgentCard } from "~/components/agent-card";
import type { Project } from "~/lib/types";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [agents, projects] = await Promise.all([listAgents(), listProjects()]);
    return { agents, projects };
  },
  component: Dashboard,
});

function Dashboard() {
  const { agents, projects } = Route.useLoaderData();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string>(
    () => projects.find((p: Project) => p.isDefault)?.id ?? projects[0]?.id ?? ""
  );

  const handleCreate = async () => {
    if (!selectedProject) return;
    setCreating(true);
    setError(null);
    try {
      await createAgent({ data: { projectId: selectedProject } });
      await router.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const projectMap = new Map(projects.map((p: Project) => [p.id, p.name]));

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">agents</h1>
        <div className="flex items-center gap-2">
          {projects.length > 0 ? (
            <>
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-zinc-500 cursor-pointer"
              >
                {projects.map((p: Project) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
              >
                {creating ? "creating..." : "+ new"}
              </button>
            </>
          ) : (
            <Link
              to="/settings"
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors"
            >
              configure a project first
            </Link>
          )}
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-sm mb-4">Error: {error}</p>
      )}

      {agents.length === 0 ? (
        <p className="text-zinc-600 text-sm">
          {projects.length === 0
            ? "Add a project in settings, then create agents here."
            : "No agents yet. Select a project and click \"+ new\"."}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              projectName={projectMap.get(agent.projectId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
