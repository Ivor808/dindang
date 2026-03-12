import { createFileRoute, useRouter } from "@tanstack/react-router";
import { listAgents, createAgent } from "~/server/agents";
import { AgentCard } from "~/components/agent-card";

export const Route = createFileRoute("/")({
  loader: () => listAgents(),
  component: Dashboard,
});

function Dashboard() {
  const agents = Route.useLoaderData();
  const router = useRouter();

  const handleCreate = async () => {
    await createAgent();
    router.invalidate();
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">agents</h1>
        <button
          onClick={handleCreate}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-sm transition-colors cursor-pointer"
        >
          + new
        </button>
      </div>

      {agents.length === 0 ? (
        <p className="text-zinc-600 text-sm">
          No agents yet. Click "+ new" to create one.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
