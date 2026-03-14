import { createServerFn } from "@tanstack/react-start";
import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { agents, projects, userCredentials } from "~/db/schema";
import { requireAuthWithOrg } from "~/server/auth";
import { getMachine, getRuntimeForMachine } from "~/server/machine-registry";
import { setupAgent, repoNameFromUrl, validateRepoUrl } from "~/server/agent-setup";
import { deriveKey, decrypt } from "~/lib/crypto";
import { randomName } from "~/lib/names";
import type { Agent } from "~/lib/types";

function rowToAgent(row: typeof agents.$inferSelect): Agent {
  return {
    id: row.id,
    name: row.name,
    orgId: row.orgId,
    projectId: row.projectId ?? "",
    machineId: row.machineId ?? "",
    createdBy: row.createdBy ?? "",
    remoteId: row.remoteId ?? "",
    workDir: row.workDir ?? "",
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    hostPort: row.hostPort ?? undefined,
  };
}

export const listAgents = createServerFn({ method: "GET" }).handler(async () => {
  const { orgId } = await requireAuthWithOrg();
  const rows = await db.select().from(agents).where(eq(agents.orgId, orgId));
  return rows.map(rowToAgent);
});

export const getAgent = createServerFn({ method: "GET" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }) => {
    const { orgId } = await requireAuthWithOrg();
    const result = await db
      .select()
      .from(agents)
      .where(and(eq(agents.name, name), eq(agents.orgId, orgId)))
      .limit(1);
    if (result.length === 0) throw new Error("Agent not found");
    return rowToAgent(result[0]!);
  });

export const createAgent = createServerFn({ method: "POST" })
  .inputValidator((data: { projectId: string; machineId: string }) => data)
  .handler(async ({ data }) => {
    const { userId, orgId } = await requireAuthWithOrg();

    // Validate project exists in org
    const projectRows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, data.projectId), eq(projects.orgId, orgId)))
      .limit(1);
    if (projectRows.length === 0) throw new Error("Project not found");
    const project = projectRows[0]!;

    // Validate machine exists in org
    const machine = await getMachine(data.machineId, orgId);

    // Get runtime for this machine
    const runtime = getRuntimeForMachine(machine);

    const name = randomName();

    // Get user's GitHub token
    let githubToken: string | undefined;
    const credRows = await db
      .select()
      .from(userCredentials)
      .where(and(eq(userCredentials.userId, userId), eq(userCredentials.provider, "github")))
      .limit(1);
    if (credRows.length > 0) {
      const key = deriveKey(userId);
      githubToken = decrypt(credRows[0]!.encryptedToken, key);
    }

    // Build env vars
    const env: Record<string, string> = {};
    if (githubToken) env.GITHUB_TOKEN = githubToken;

    // Get Anthropic key
    const anthropicRows = await db
      .select()
      .from(userCredentials)
      .where(and(eq(userCredentials.userId, userId), eq(userCredentials.provider, "anthropic")))
      .limit(1);
    if (anthropicRows.length > 0) {
      const key = deriveKey(userId);
      env.ANTHROPIC_API_KEY = decrypt(anthropicRows[0]!.encryptedToken, key);
    }

    // Create the container/runtime
    const { remoteId, hostPort } = await runtime.create({
      name,
      machineId: machine.id,
      orgId,
      env,
      devPort: project.devPort ?? undefined,
    });

    // Determine workDir
    const repoUrl = project.repoUrl ? validateRepoUrl(project.repoUrl) : undefined;
    const workDir = repoUrl ? `/home/${repoNameFromUrl(repoUrl)}` : "/root";

    // Insert agent record
    const agentRows = await db
      .insert(agents)
      .values({
        orgId,
        projectId: project.id,
        machineId: machine.id,
        createdBy: userId,
        name,
        remoteId,
        workDir,
        status: "provisioning",
        hostPort,
      })
      .returning();
    const agentRecord = agentRows[0]!;

    // Background setup — don't await
    if (repoUrl) {
      const callbackUrl = process.env.DINDANG_CALLBACK_URL ?? "http://host.docker.internal:3000";
      runtime
        .getTransport(remoteId)
        .then((transport) =>
          setupAgent(transport, {
            name,
            repoUrl,
            workDir,
            githubToken,
            setupCommand: project.setupCommand ?? undefined,
            callbackUrl,
          }),
        )
        .then(async () => {
          await db.update(agents).set({ status: "ready" }).where(eq(agents.id, agentRecord.id));
        })
        .catch(async () => {
          await db.update(agents).set({ status: "error" }).where(eq(agents.id, agentRecord.id));
        });
    } else {
      // No repo to clone, mark as ready immediately
      await db.update(agents).set({ status: "ready" }).where(eq(agents.id, agentRecord.id));
    }

    return rowToAgent(agentRecord);
  });

export const redeployAgent = createServerFn({ method: "POST" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }) => {
    const { userId, orgId } = await requireAuthWithOrg();
    const result = await db
      .select()
      .from(agents)
      .where(and(eq(agents.name, name), eq(agents.orgId, orgId)))
      .limit(1);
    if (result.length === 0) throw new Error("Agent not found");
    const agent = result[0]!;

    if (!agent.remoteId || !agent.machineId || !agent.projectId)
      throw new Error("Agent is missing required fields for redeploy");

    const machine = await getMachine(agent.machineId, orgId);
    const runtime = getRuntimeForMachine(machine);
    if (!runtime.redeploy) throw new Error("This machine type does not support redeploy");

    // Get project for devPort
    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, agent.projectId))
      .limit(1);
    const project = projectRows[0];

    // Rebuild env
    const env: Record<string, string> = {};
    const credRows = await db
      .select()
      .from(userCredentials)
      .where(and(eq(userCredentials.userId, agent.createdBy!), eq(userCredentials.provider, "github")))
      .limit(1);
    if (credRows.length > 0) {
      const key = deriveKey(agent.createdBy!);
      env.GITHUB_TOKEN = decrypt(credRows[0]!.encryptedToken, key);
    }
    const anthropicRows = await db
      .select()
      .from(userCredentials)
      .where(and(eq(userCredentials.userId, agent.createdBy!), eq(userCredentials.provider, "anthropic")))
      .limit(1);
    if (anthropicRows.length > 0) {
      const key = deriveKey(agent.createdBy!);
      env.ANTHROPIC_API_KEY = decrypt(anthropicRows[0]!.encryptedToken, key);
    }

    const { remoteId, hostPort } = await runtime.redeploy(agent.remoteId, {
      name: agent.name,
      machineId: machine.id,
      orgId,
      env,
      devPort: project?.devPort ?? undefined,
    });

    await db
      .update(agents)
      .set({ remoteId, hostPort, status: "ready" })
      .where(eq(agents.id, agent.id));

    return rowToAgent({ ...agent, remoteId, hostPort: hostPort ?? null, status: "ready" });
  });

export const stopAgent = createServerFn({ method: "POST" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }) => {
    const { orgId } = await requireAuthWithOrg();
    const result = await db
      .select()
      .from(agents)
      .where(and(eq(agents.name, name), eq(agents.orgId, orgId)))
      .limit(1);
    if (result.length === 0) throw new Error("Agent not found");
    const agent = result[0]!;

    if (!agent.remoteId) throw new Error("Agent has no remote ID");
    if (!agent.machineId) throw new Error("Agent has no machine");

    const machine = await getMachine(agent.machineId, orgId);
    const runtime = getRuntimeForMachine(machine);
    await runtime.stop(agent.remoteId);

    await db
      .update(agents)
      .set({ status: "ready" })
      .where(eq(agents.id, agent.id));

    return rowToAgent({ ...agent, status: "ready" });
  });

export const removeAgent = createServerFn({ method: "POST" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }) => {
    const { userId, orgId } = await requireAuthWithOrg();
    const result = await db
      .select()
      .from(agents)
      .where(and(eq(agents.name, name), eq(agents.orgId, orgId)))
      .limit(1);
    if (result.length === 0) throw new Error("Agent not found");
    const agent = result[0]!;

    // Members can only remove their own agents
    if (agent.createdBy && agent.createdBy !== userId) {
      // Check if user is admin or owner — they can remove any agent
      const { requireRole } = await import("~/server/auth");
      await requireRole(userId, orgId, "admin");
    }

    if (agent.remoteId && agent.machineId) {
      const machine = await getMachine(agent.machineId, orgId);
      const runtime = getRuntimeForMachine(machine);
      await runtime.remove(agent.remoteId);
    }

    await db
      .delete(agents)
      .where(eq(agents.id, agent.id));

    return { ok: true };
  });
