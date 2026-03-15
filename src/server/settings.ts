import { createServerFn } from "@tanstack/react-start";
import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { projects, orgMembers, userCredentials } from "~/db/schema";
import { requireAuthWithOrg, requireRole } from "~/server/auth";
import {
  listMachines,
  createMachine,
  updateMachine,
  deleteMachine,
} from "~/server/machine-registry";
import { deriveKey, encrypt } from "~/lib/crypto";

// ── Projects ────────────────────────────────────────────────────────────────

export const listProjects = createServerFn({ method: "GET" }).handler(async () => {
  const { orgId } = await requireAuthWithOrg();
  return db.select().from(projects).where(eq(projects.orgId, orgId));
});

export const createProject = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { name: string; repoUrl?: string; setupCommand?: string; aiCli?: "claude" | "codex" | "none"; devPort?: number; isDefault: boolean }) => {
      if (!data.name || typeof data.name !== "string") throw new Error("Name is required");
      if (data.name.length > 100) throw new Error("Name too long");
      if (data.repoUrl && data.repoUrl.length > 500) throw new Error("Repo URL too long");
      if (data.setupCommand && data.setupCommand.length > 1000) throw new Error("Setup command too long");
      if (data.devPort && (data.devPort < 1 || data.devPort > 65535)) throw new Error("Invalid port number");
      return data;
    },
  )
  .handler(async ({ data }) => {
    const { userId, orgId } = await requireAuthWithOrg();
    await requireRole(userId, orgId, "admin");

    const result = await db
      .insert(projects)
      .values({
        orgId,
        name: data.name,
        repoUrl: data.repoUrl || null,
        setupCommand: data.setupCommand,
        aiCli: data.aiCli ?? "claude",
        devPort: data.devPort,
        isDefault: data.isDefault,
      })
      .returning();

    return result[0]!;
  });

export const editProject = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; name?: string; repoUrl?: string; setupCommand?: string; aiCli?: "claude" | "codex" | "none"; devPort?: number; isDefault?: boolean }) => data,
  )
  .handler(async ({ data }) => {
    const { userId, orgId } = await requireAuthWithOrg();
    await requireRole(userId, orgId, "admin");

    const { id, ...updates } = data;
    await db
      .update(projects)
      .set(updates)
      .where(and(eq(projects.id, id), eq(projects.orgId, orgId)));

    const result = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.orgId, orgId)))
      .limit(1);
    if (result.length === 0) throw new Error("Project not found");
    return result[0]!;
  });

export const deleteProject = createServerFn({ method: "POST" })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const { userId, orgId } = await requireAuthWithOrg();
    await requireRole(userId, orgId, "admin");

    await db
      .delete(projects)
      .where(and(eq(projects.id, id), eq(projects.orgId, orgId)));
    return { ok: true };
  });

// ── Machines ────────────────────────────────────────────────────────────────

export const listMachinesApi = createServerFn({ method: "GET" }).handler(async () => {
  const { orgId } = await requireAuthWithOrg();
  return listMachines(orgId);
});

export const createMachineApi = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      name: string;
      type: "server" | "terminal" | "local";
      host?: string;
      port?: number;
      username?: string;
      authMethod?: "key" | "password";
      credential?: string;
      hostKeyFingerprint?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { userId, orgId } = await requireAuthWithOrg();
    await requireRole(userId, orgId, "admin");
    return createMachine(orgId, data);
  });

export const editMachineApi = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      name?: string;
      host?: string;
      port?: number;
      username?: string;
      authMethod?: "key" | "password";
      credential?: string;
      hostKeyFingerprint?: string;
      enabled?: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { userId, orgId } = await requireAuthWithOrg();
    await requireRole(userId, orgId, "admin");
    const { id, ...updates } = data;
    await updateMachine(id, orgId, updates);
    return { ok: true };
  });

export const deleteMachineApi = createServerFn({ method: "POST" })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const { userId, orgId } = await requireAuthWithOrg();
    await requireRole(userId, orgId, "admin");
    await deleteMachine(id, orgId);
    return { ok: true };
  });

// ── Credentials ─────────────────────────────────────────────────────────────

export const saveCredential = createServerFn({ method: "POST" })
  .inputValidator((data: { provider: "github" | "anthropic"; token: string }) => data)
  .handler(async ({ data }) => {
    const { userId } = await requireAuthWithOrg();
    const key = deriveKey(userId);
    const encryptedToken = encrypt(data.token, key);

    await db
      .insert(userCredentials)
      .values({
        userId,
        provider: data.provider,
        encryptedToken,
      })
      .onConflictDoUpdate({
        target: [userCredentials.userId, userCredentials.provider],
        set: {
          encryptedToken,
          updatedAt: new Date(),
        },
      });

    return { ok: true };
  });

export const getCredentialStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { userId } = await requireAuthWithOrg();
  const rows = await db
    .select({ provider: userCredentials.provider })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId));

  const providers = new Set(rows.map((r) => r.provider));
  return {
    hasGithub: providers.has("github"),
    hasAnthropic: providers.has("anthropic"),
  };
});

// ── Team ────────────────────────────────────────────────────────────────────

export const listMembers = createServerFn({ method: "GET" }).handler(async () => {
  const { orgId } = await requireAuthWithOrg();
  return db
    .select({
      id: orgMembers.id,
      userId: orgMembers.userId,
      role: orgMembers.role,
      createdAt: orgMembers.createdAt,
    })
    .from(orgMembers)
    .where(eq(orgMembers.orgId, orgId));
});

export const inviteMember = createServerFn({ method: "POST" })
  .inputValidator((data: { userId: string; role: "admin" | "member" }) => data)
  .handler(async ({ data }) => {
    const { userId, orgId } = await requireAuthWithOrg();
    await requireRole(userId, orgId, "admin");

    const result = await db
      .insert(orgMembers)
      .values({
        orgId,
        userId: data.userId,
        role: data.role,
      })
      .returning();

    return result[0]!;
  });

export const removeMember = createServerFn({ method: "POST" })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const { userId, orgId } = await requireAuthWithOrg();
    await requireRole(userId, orgId, "admin");

    // Cannot remove the owner
    const member = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.id, id), eq(orgMembers.orgId, orgId)))
      .limit(1);
    if (member.length === 0) throw new Error("Member not found");
    if (member[0]!.role === "owner") throw new Error("Cannot remove the owner");

    await db
      .delete(orgMembers)
      .where(and(eq(orgMembers.id, id), eq(orgMembers.orgId, orgId)));

    return { ok: true };
  });

export const changeRole = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; role: "admin" | "member" }) => data)
  .handler(async ({ data }) => {
    const { userId, orgId } = await requireAuthWithOrg();
    await requireRole(userId, orgId, "owner");

    // Cannot change owner's role
    const member = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.id, data.id), eq(orgMembers.orgId, orgId)))
      .limit(1);
    if (member.length === 0) throw new Error("Member not found");
    if (member[0]!.role === "owner") throw new Error("Cannot change the owner's role");

    await db
      .update(orgMembers)
      .set({ role: data.role })
      .where(and(eq(orgMembers.id, data.id), eq(orgMembers.orgId, orgId)));

    return { ok: true };
  });

// ── Legacy compat: loadSettings for the settings page ───────────────────────

export const loadSettings = createServerFn({ method: "GET" }).handler(async () => {
  const { userId, orgId } = await requireAuthWithOrg();

  const credRows = await db
    .select({ provider: userCredentials.provider })
    .from(userCredentials)
    .where(eq(userCredentials.userId, userId));
  const providers = new Set(credRows.map((r) => r.provider));

  const projectRows = await db
    .select()
    .from(projects)
    .where(eq(projects.orgId, orgId));

  return {
    hasAnthropicKey: providers.has("anthropic"),
    hasGithubToken: providers.has("github"),
    projects: projectRows.map((p) => ({
      id: p.id,
      orgId: p.orgId,
      name: p.name,
      repoUrl: p.repoUrl ?? "",
      setupCommand: p.setupCommand ?? undefined,
      devPort: p.devPort ?? undefined,
      isDefault: p.isDefault,
    })),
  };
});
