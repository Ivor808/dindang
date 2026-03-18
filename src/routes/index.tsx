import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { listAgents, createAgent, removeAgent, redeployAgent, renameAgent, setAgentColor, checkDirtyState } from "~/server/agents";
import { listProjects, listMachinesApi } from "~/server/settings";
import { AgentCard } from "~/components/agent-card";
import { toErrorMessage } from "~/lib/errors";
import type { Project, Machine } from "~/lib/types";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [agents, projects, machines] = await Promise.all([
      listAgents(),
      listProjects(),
      listMachinesApi(),
    ]);
    return { agents, projects, machines };
  },
  component: Dashboard,
});

function Dashboard() {
  const { agents, projects, machines } = Route.useLoaderData();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string>(
    () => projects.find((p: Project) => p.isDefault)?.id ?? projects[0]?.id ?? "",
  );
  const [selectedMachine, setSelectedMachine] = useState<string>(
    () => machines.find((m: Machine) => m.enabled)?.id ?? "",
  );

  const handleCreate = async () => {
    if (!selectedProject || !selectedMachine) return;
    setCreating(true);
    setError(null);
    try {
      await createAgent({
        data: { projectId: selectedProject, machineId: selectedMachine },
      });
      await router.invalidate();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const hasActive = agents.some((a) => a.status === "provisioning" || a.status === "busy");

  // Auto-refresh while any agent is provisioning or busy
  useEffect(() => {
    if (!hasActive) return;
    const interval = setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      await router.invalidate();
    }, 3000);
    return () => clearInterval(interval);
  }, [hasActive, router]);

  const projectMap = useMemo(() => new Map(projects.map((p: Project) => [p.id, p.name])), [projects]);
  const projectCliMap = useMemo(() => new Map(projects.map((p: Project) => [p.id, p.aiCli])), [projects]);

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
              <select
                value={selectedMachine}
                onChange={(e) => setSelectedMachine(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-zinc-500 cursor-pointer"
              >
                {machines.map((m: Machine) => (
                  <option
                    key={m.id}
                    value={m.id}
                    disabled={!m.enabled}
                    className={!m.enabled ? "text-zinc-600" : ""}
                  >
                    {m.name} ({m.type})
                  </option>
                ))}
              </select>
              <button
                onClick={handleCreate}
                disabled={creating || !selectedMachine}
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
              aiCli={projectCliMap.get(agent.projectId)}
              onRemove={async () => {
                try {
                  const { dirty, summary } = await checkDirtyState({ data: agent.name }).catch(() => ({ dirty: false, summary: "" }));
                  if (dirty && !window.confirm(`This agent has ${summary}. Remove anyway? Uncommitted changes will be lost.`)) return;
                  await removeAgent({ data: agent.name });
                  await router.invalidate();
                } catch (e) {
                  setError(toErrorMessage(e));
                }
              }}
              onRedeploy={async () => {
                try {
                  const { dirty, summary } = await checkDirtyState({ data: agent.name }).catch(() => ({ dirty: false, summary: "" }));
                  if (dirty && !window.confirm(`This agent has ${summary}. Redeploy anyway? Uncommitted changes will be lost.`)) return;
                  await redeployAgent({ data: agent.name });
                  await router.invalidate();
                } catch (e) {
                  setError(toErrorMessage(e));
                }
              }}
              onRename={async (newName) => {
                try {
                  await renameAgent({ data: { name: agent.name, newName } });
                  await router.invalidate();
                } catch (e) {
                  setError(toErrorMessage(e));
                }
              }}
              onColorChange={async (color) => {
                try {
                  await setAgentColor({ data: { name: agent.name, color } });
                  await router.invalidate();
                } catch (e) {
                  setError(toErrorMessage(e));
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
