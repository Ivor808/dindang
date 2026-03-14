import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { machines } from "~/db/schema";
import type { AgentRuntime } from "~/lib/transport";
import { DockerAgentRuntime } from "~/server/runtimes/docker";
import { deriveKey, encrypt, decrypt } from "~/lib/crypto";
import { SSHAgentRuntime } from "~/server/runtimes/ssh";

export async function listMachines(orgId: string) {
  return db.select().from(machines).where(eq(machines.orgId, orgId));
}

export async function getMachine(machineId: string, orgId: string) {
  const result = await db
    .select()
    .from(machines)
    .where(and(eq(machines.id, machineId), eq(machines.orgId, orgId)))
    .limit(1);
  if (result.length === 0) throw new Error("Machine not found");
  return result[0]!;
}

export async function createMachine(
  orgId: string,
  data: {
    name: string;
    type: "server" | "terminal" | "local";
    host?: string;
    port?: number;
    username?: string;
    authMethod?: "key" | "password";
    credential?: string;
    hostKeyFingerprint?: string;
  },
) {
  // Validate name: alphanumeric + hyphens
  if (!/^[a-zA-Z0-9-]+$/.test(data.name)) {
    throw new Error("Machine name must be alphanumeric with hyphens only");
  }

  // Validate SSH fields
  if (data.type === "server" || data.type === "terminal") {
    if (!data.host) throw new Error("Host is required for SSH-based machines");
    if (!data.username) throw new Error("Username is required for SSH-based machines");
    if (data.port && (data.port < 1 || data.port > 65535)) {
      throw new Error("Port must be between 1 and 65535");
    }
  }

  // Encrypt credential if provided
  let encryptedCredential: string | undefined;
  if (data.credential) {
    const key = deriveKey(orgId);
    encryptedCredential = encrypt(data.credential, key);
  }

  const result = await db
    .insert(machines)
    .values({
      orgId,
      name: data.name,
      type: data.type,
      host: data.host ?? "localhost",
      port: data.port ?? 22,
      username: data.username,
      authMethod: data.authMethod,
      encryptedCredential,
      hostKeyFingerprint: data.hostKeyFingerprint,
    })
    .returning();

  return result[0]!;
}

export async function updateMachine(
  machineId: string,
  orgId: string,
  data: Partial<{
    name: string;
    host: string;
    port: number;
    username: string;
    authMethod: "key" | "password";
    credential: string;
    hostKeyFingerprint: string;
    enabled: boolean;
    status: "connected" | "unreachable" | "unknown";
  }>,
) {
  const updates: Record<string, unknown> = { ...data };

  // Encrypt credential if being updated
  if (data.credential) {
    const key = deriveKey(orgId);
    updates.encryptedCredential = encrypt(data.credential, key);
    delete updates.credential;
  }

  await db
    .update(machines)
    .set(updates)
    .where(and(eq(machines.id, machineId), eq(machines.orgId, orgId)));
}

export async function deleteMachine(machineId: string, orgId: string) {
  await db
    .delete(machines)
    .where(and(eq(machines.id, machineId), eq(machines.orgId, orgId)));
}

export function getRuntimeForMachine(machine: {
  type: string;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  authMethod?: string | null;
  encryptedCredential?: string | null;
  orgId: string;
}): AgentRuntime {
  if (machine.type === "local") {
    return new DockerAgentRuntime();
  }
  if (machine.type === "terminal") {
    let credential: string | undefined;
    if (machine.encryptedCredential) {
      const key = deriveKey(machine.orgId);
      credential = decrypt(machine.encryptedCredential, key);
    }
    return new SSHAgentRuntime({
      host: machine.host!,
      port: machine.port ?? 22,
      username: machine.username!,
      ...(machine.authMethod === "key"
        ? { privateKey: credential }
        : { password: credential }),
    });
  }
  if (machine.type === "server") {
    throw new Error("Server runtime not yet implemented");
  }
  throw new Error(`Unsupported machine type: ${machine.type}`);
}
