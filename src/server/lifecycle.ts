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

let registered = false;

/** Register process signal handlers for graceful shutdown. Idempotent.
 *  Agent containers are left running — they're independent and survive
 *  dindang restarts (e.g., during updates via docker compose pull). */
export function registerShutdownHandlers(): void {
  if (registered) return;
  registered = true;

  const handler = (signal: string) => {
    console.log(`[lifecycle] received ${signal} — exiting (agent containers left running)`);
    process.exit(0);
  };

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
}
