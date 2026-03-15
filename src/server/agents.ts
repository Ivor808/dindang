import { createServerFn } from "@tanstack/react-start";
import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { agents, machines, projects, userCredentials } from "~/db/schema";
import { requireAuthWithOrg } from "~/server/auth";
import { getMachine, getRuntimeForMachine } from "~/server/machine-registry";
import { setupAgent, repoNameFromUrl, validateRepoUrl, asUser } from "~/server/agent-setup";
import { destroyAgentSession } from "~/server/terminal";
import { deriveKey, decrypt } from "~/lib/crypto";
import { randomName } from "~/lib/names";
import { toErrorMessage } from "~/lib/errors";
import type { Agent } from "~/lib/types";
import type { ExecResult } from "~/lib/transport";

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
    errorMessage: row.errorMessage ?? undefined,
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
    const agent = result[0]!;
    const out = rowToAgent(agent);

    // Resolve preview URL based on machine type
    if (agent.machineId && agent.hostPort) {
      const machineRows = await db.select().from(machines).where(eq(machines.id, agent.machineId)).limit(1);
      const machine = machineRows[0];
      if (machine) {
        if (machine.type === "local") {
          out.previewUrl = `/preview/${agent.name}/`;
        } else {
          out.previewUrl = `http://${machine.host}:${agent.hostPort}`;
        }
      }
    }

    return out;
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

    // Block if project has a repo but user has no GitHub token
    if (project.repoUrl && !githubToken) {
      throw new Error("GitHub token required. Add it in Settings > Credentials before creating agents for projects with a repo URL.");
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
    const workDir = repoUrl ? `/home/dev/${repoNameFromUrl(repoUrl)}` : "/home/dev";

    // Insert agent record — if this fails, clean up the container
    let agentRecord: typeof agents.$inferSelect;
    try {
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
      agentRecord = agentRows[0]!;
    } catch (e) {
      // DB insert failed — remove the orphaned container
      try { await runtime.remove(remoteId); } catch { /* best effort */ }
      throw e;
    }

    // Background setup — don't await
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
          aiCli: project.aiCli,
          callbackUrl,
        }),
      )
      .then(async () => {
        await db.update(agents).set({ status: "ready", errorMessage: null }).where(eq(agents.id, agentRecord.id));
      })
      .catch(async (err) => {
        const msg = toErrorMessage(err);
        console.error(`[agent] setup failed for ${name}:`, msg);
        await db.update(agents).set({ status: "error", errorMessage: msg }).where(eq(agents.id, agentRecord.id));
        // Stop the container so it doesn't sit idle eating resources
        try { await runtime.stop(remoteId); } catch { /* best effort */ }
      });

    return rowToAgent(agentRecord);
  });

export interface AgentHealth {
  running: boolean;
  user: string | null;
  git: boolean;
  curl: boolean;
  node: boolean;
  aiCli: { name: string; installed: boolean } | null;
  workDirExists: boolean;
}

export const checkAgentHealth = createServerFn({ method: "GET" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }): Promise<AgentHealth> => {
    const { orgId } = await requireAuthWithOrg();
    const result = await db
      .select()
      .from(agents)
      .where(and(eq(agents.name, name), eq(agents.orgId, orgId)))
      .limit(1);
    if (result.length === 0) throw new Error("Agent not found");
    const agent = result[0]!;

    if (!agent.remoteId || !agent.machineId)
      return { running: false, user: null, git: false, curl: false, node: false, aiCli: null, workDirExists: false };

    const machine = await getMachine(agent.machineId, orgId);
    const runtime = getRuntimeForMachine(machine);

    const running = await runtime.isRunning(agent.remoteId);
    if (!running)
      return { running: false, user: null, git: false, curl: false, node: false, aiCli: null, workDirExists: false };

    // Look up project AI CLI config before opening transport
    let cliName: string | null = null;
    if (agent.projectId) {
      const projectRows = await db.select().from(projects).where(eq(projects.id, agent.projectId)).limit(1);
      const project = projectRows[0];
      if (project && project.aiCli !== "none") {
        cliName = project.aiCli;
      }
    }

    const transport = await runtime.getTransport(agent.remoteId);
    try {
      // Run all health checks in parallel
      const checks = await Promise.all([
        transport.exec(asUser("whoami")),
        transport.exec(asUser("which git")),
        transport.exec(asUser("which curl")),
        transport.exec(asUser("which node")),
        ...(cliName ? [transport.exec(asUser(`which ${cliName}`))] : []),
        ...(agent.workDir ? [transport.fileExists(agent.workDir)] : []),
      ]);

      const [whoami, gitCheck, curlCheck, nodeCheck] = checks;
      const user = (whoami as ExecResult).exitCode === 0 ? (whoami as ExecResult).stdout.trim() : null;
      const git = (gitCheck as ExecResult).exitCode === 0;
      const curl = (curlCheck as ExecResult).exitCode === 0;
      const node = (nodeCheck as ExecResult).exitCode === 0;

      let aiCli: { name: string; installed: boolean } | null = null;
      let offset = 4;
      if (cliName) {
        aiCli = { name: cliName, installed: (checks[offset] as ExecResult).exitCode === 0 };
        offset++;
      }
      const workDirExists = agent.workDir ? (checks[offset] as boolean) : false;

      return { running, user, git, curl, node, aiCli, workDirExists };
    } finally {
      await transport.destroy();
    }
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

    destroyAgentSession(agent.name);

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
      .set({ remoteId, hostPort, status: "provisioning" })
      .where(eq(agents.id, agent.id));

    // Get GitHub token for setup
    let githubToken: string | undefined;
    if (credRows.length > 0) {
      githubToken = env.GITHUB_TOKEN;
    }

    // Re-run setup in background (system packages and user are in the container layer, not the volume)
    const repoUrl = project?.repoUrl ? validateRepoUrl(project.repoUrl) : undefined;
    const callbackUrl = process.env.DINDANG_CALLBACK_URL ?? "http://host.docker.internal:3000";
    runtime
      .getTransport(remoteId)
      .then((transport) =>
        setupAgent(transport, {
          name: agent.name,
          repoUrl,
          workDir: agent.workDir ?? "/home/dev",
          githubToken,
          setupCommand: project?.setupCommand ?? undefined,
          aiCli: project?.aiCli ?? "claude",
          callbackUrl,
        }),
      )
      .then(async () => {
        await db.update(agents).set({ status: "ready", errorMessage: null }).where(eq(agents.id, agent.id));
      })
      .catch(async (err) => {
        const msg = toErrorMessage(err);
        console.error(`[agent] redeploy setup failed for ${agent.name}:`, msg);
        await db.update(agents).set({ status: "error", errorMessage: msg }).where(eq(agents.id, agent.id));
        try { await runtime.stop(remoteId); } catch { /* best effort */ }
      });

    return rowToAgent({ ...agent, remoteId, hostPort: hostPort ?? null, status: "provisioning" });
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
    destroyAgentSession(agent.name);
    // Stop and remove the container to free resources (there's no restart — only redeploy)
    await runtime.remove(agent.remoteId);

    await db
      .delete(agents)
      .where(eq(agents.id, agent.id));

    return { ok: true };
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

    destroyAgentSession(agent.name);

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
