import { eq } from "drizzle-orm";
import { db } from "~/db";
import { agents, machines } from "~/db/schema";
import { getRuntimeForMachine } from "~/server/machine-registry";
import { isLocalMode } from "~/lib/mode";
import { seedLocalUser } from "~/server/seed";

/**
 * Reconcile agents on startup.
 * Stops containers for agents in "error" state.
 */
export async function reconcileOnStartup(): Promise<void> {
  try {
    if (isLocalMode()) {
      await seedLocalUser();
    }
    const errorAgents = await db
      .select({
        id: agents.id,
        name: agents.name,
        remoteId: agents.remoteId,
        machineId: agents.machineId,
      })
      .from(agents)
      .where(eq(agents.status, "error"));

    if (errorAgents.length === 0) {
      console.log("[lifecycle] reconciliation done — no error-state agents");
      return;
    }

    for (const agent of errorAgents) {
      if (!agent.remoteId || !agent.machineId) continue;

      try {
        const machineRows = await db
          .select()
          .from(machines)
          .where(eq(machines.id, agent.machineId))
          .limit(1);
        if (machineRows.length === 0) continue;

        const runtime = getRuntimeForMachine(machineRows[0]!);
        const running = await runtime.isRunning(agent.remoteId);
        if (running) {
          console.log(`[lifecycle] stopping error-state agent ${agent.name} (${agent.remoteId.slice(0, 12)})`);
          await runtime.stop(agent.remoteId);
        }
      } catch (e) {
        console.error(`[lifecycle] failed to stop error agent ${agent.name}:`, e);
      }
    }

    console.log(`[lifecycle] reconciliation done — checked ${errorAgents.length} error agents`);
  } catch (e) {
    console.error("[lifecycle] reconciliation failed:", e);
  }
}

/**
 * Graceful shutdown: stop all running agent containers.
 * Called on SIGTERM / SIGINT.
 */
async function shutdownContainers(): Promise<void> {
  console.log("[lifecycle] shutting down — stopping agent containers...");
  try {
    const allAgents = await db
      .select({
        name: agents.name,
        remoteId: agents.remoteId,
        machineId: agents.machineId,
      })
      .from(agents);

    const results = await Promise.allSettled(
      allAgents
        .filter((a) => a.remoteId && a.machineId)
        .map(async (agent) => {
          const machineRows = await db
            .select()
            .from(machines)
            .where(eq(machines.id, agent.machineId!))
            .limit(1);
          if (machineRows.length === 0) return;

          const runtime = getRuntimeForMachine(machineRows[0]!);
          const running = await runtime.isRunning(agent.remoteId!);
          if (running) {
            console.log(`[lifecycle] stopping ${agent.name}`);
            await runtime.stop(agent.remoteId!);
          }
        }),
    );

    const stopped = results.filter((r) => r.status === "fulfilled").length;
    console.log(`[lifecycle] shutdown complete — processed ${stopped}/${allAgents.length} agents`);
  } catch (e) {
    console.error("[lifecycle] shutdown error:", e);
  }
}

let registered = false;

/** Register process signal handlers for graceful shutdown. Idempotent. */
export function registerShutdownHandlers(): void {
  if (registered) return;
  registered = true;

  const handler = (signal: string) => {
    console.log(`[lifecycle] received ${signal}`);
    shutdownContainers().finally(() => process.exit(0));
  };

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
}
