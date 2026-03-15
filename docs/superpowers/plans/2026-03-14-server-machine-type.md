# Server Machine Type Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Server" machine type that SSHs into a user's server and manages Docker containers remotely, enabling the primary use case of "I have a home server, manage everything for me."

**Architecture:** New `ServerAgentRuntime` and `ServerTransport` classes compose SSH transport with Docker CLI commands. Existing machine types renamed: `docker` → `local`, `ssh` → `terminal`. All new code uses dependency injection for testability.

**Tech Stack:** ssh2, Docker CLI over SSH, Drizzle ORM, Vitest

**Spec:** `docs/superpowers/specs/2026-03-14-server-machine-type-design.md`

---

## Chunk 1: Schema Migration and Type Renames

### Task 1: Update Type Definitions

**Files:**
- Modify: `src/lib/types.ts:2-3`
- Modify: `src/lib/transport.ts:29-34`

- [ ] **Step 1: Update MachineType in types.ts**

```typescript
// src/lib/types.ts line 3
export type MachineType = "server" | "terminal" | "local";
```

- [ ] **Step 2: Add orgId to AgentRuntimeOptions**

The spec requires org ID prefixing on container names. Add `orgId` to the options interface in `src/lib/transport.ts:29-34`:

```typescript
export interface AgentRuntimeOptions {
  name: string;
  machineId: string;
  orgId: string;
  env: Record<string, string>;
  devPort?: number;
}
```

- [ ] **Step 3: Update all callers passing AgentRuntimeOptions**

In `src/server/agents.ts`, add `orgId` to the options passed to `runtime.create()` and `runtime.redeploy()`:

```typescript
// In createAgent handler (~line 97):
const { remoteId, hostPort } = await runtime.create({
  name,
  machineId: machine.id,
  orgId,
  env,
  devPort: project.devPort ?? undefined,
});

// In redeployAgent handler (~line 202):
const { remoteId, hostPort } = await runtime.redeploy(agent.remoteId, {
  name: agent.name,
  machineId: machine.id,
  orgId,
  env,
  devPort: project?.devPort ?? undefined,
});
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/transport.ts src/server/agents.ts
git commit -m "refactor: rename machine types, add orgId to runtime options"
```

### Task 2: Update Database Schema

**Files:**
- Modify: `src/db/schema.ts:37`

- [ ] **Step 1: Update type enum in schema**

Change the machines table `type` field at line 37:

```typescript
type: text("type", { enum: ["server", "terminal", "local"] }).notNull(),
```

- [ ] **Step 2: Push schema to local DB**

Since this is local dev with no production data, use `drizzle-kit push` directly. The enum is application-level only (the column is `text`), so no SQL migration is needed — just update existing rows:

```bash
npx drizzle-kit push
```

Then update any existing rows in the database:

```bash
psql postgresql://postgres:postgres@localhost:54422/postgres -c "UPDATE machines SET type = 'local' WHERE type = 'docker'; UPDATE machines SET type = 'terminal' WHERE type = 'ssh';"
```

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "refactor: update machine type enum to server/terminal/local"
```

### Task 3: Update Machine Registry

**Files:**
- Modify: `src/server/machine-registry.ts:23-139`

- [ ] **Step 1: Update createMachine type signature and validation**

Change the `data.type` parameter and update validation to apply to both SSH-based types:

```typescript
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
  // ... name validation unchanged ...

  // Validate SSH fields for server and terminal types
  if (data.type === "server" || data.type === "terminal") {
    if (!data.host) throw new Error("Host is required for SSH-based machines");
    if (!data.username) throw new Error("Username is required for SSH-based machines");
    if (data.port && (data.port < 1 || data.port > 65535)) {
      throw new Error("Port must be between 1 and 65535");
    }
  }
  // ... rest unchanged ...
}
```

- [ ] **Step 2: Update getRuntimeForMachine**

Rename `"docker"` → `"local"`, `"ssh"` → `"terminal"`, add `"server"` placeholder:

```typescript
if (machine.type === "local") {
  return new DockerAgentRuntime();
}
if (machine.type === "terminal") {
  // ... same as current "ssh" case ...
}
if (machine.type === "server") {
  // Placeholder — implemented in Task 8
  throw new Error("Server runtime not yet implemented");
}
```

Note: Between Chunk 1 and Chunk 4, creating a "server" machine and using it will throw. This is expected.

- [ ] **Step 3: Commit**

```bash
git add src/server/machine-registry.ts
git commit -m "refactor: update machine registry for server/terminal/local types"
```

### Task 4: Update Settings Server Functions

**Files:**
- Modify: `src/server/settings.ts:98`

- [ ] **Step 1: Update type union in createMachineApi input validator**

At line 98 of `src/server/settings.ts`, change:

```typescript
type: "docker" | "ssh";
```

to:

```typescript
type: "server" | "terminal" | "local";
```

Search for any other `"docker"` or `"ssh"` references in the file and update them.

- [ ] **Step 2: Commit**

```bash
git add src/server/settings.ts
git commit -m "refactor: update settings server functions for new machine types"
```

### Task 5: Update UI Components

**Files:**
- Modify: `src/routes/settings.tsx` (MachinesTab, lines 332-539)
- Modify: `src/components/machine-card.tsx`
- Modify: `src/routes/index.tsx:78-93`

- [ ] **Step 1: Update MachinesTab type state and dropdown**

In `settings.tsx` MachinesTab, change the type state default and dropdown options:

```typescript
const [type, setType] = useState<"server" | "terminal">("server");
```

Update the select:

```tsx
<select
  value={type}
  onChange={(e) => setType(e.target.value as "server" | "terminal")}
  className="..."
>
  <option value="server">Server (managed Docker)</option>
  <option value="terminal">Terminal (direct SSH)</option>
</select>
```

- [ ] **Step 2: Update conditional SSH fields display**

Change `{type === "ssh" && (` to `{(type === "server" || type === "terminal") && (` since both types need SSH credentials.

- [ ] **Step 3: Update handleAdd submission logic**

In the `handleAdd` function (~line 359), update the conditional that sends SSH fields. Change:

```typescript
...(type === "ssh"
  ? { host: host.trim(), ... }
  : {}),
```

to:

```typescript
...(type === "server" || type === "terminal"
  ? { host: host.trim(), port: parseInt(port, 10) || 22, username: username.trim(), authMethod, credential: credential.trim() || undefined }
  : {}),
```

- [ ] **Step 4: Update machine-card.tsx display**

Update the type display and detail logic:

```typescript
const detail = machine.type === "local"
  ? "Local Docker"
  : `${machine.username ?? ""}@${machine.host ?? ""}:${machine.port ?? 22}`;

const typeLabel = machine.type === "server"
  ? "server"
  : machine.type === "terminal"
    ? "terminal"
    : "local";
```

- [ ] **Step 5: Update dashboard machine dropdown**

In `index.tsx`, update the option label:

```tsx
<option key={m.id} value={m.id} disabled={!m.enabled}>
  {m.name} ({m.type})
</option>
```

- [ ] **Step 6: Verify the app loads**

```bash
npm run dev
```

Navigate to Settings > Machines and verify the new type labels appear, SSH fields show for both Server and Terminal.

- [ ] **Step 7: Commit**

```bash
git add src/routes/settings.tsx src/components/machine-card.tsx src/routes/index.tsx
git commit -m "refactor: update UI for server/terminal/local machine types"
```

## Chunk 2: ServerTransport Implementation with Tests

### Task 6: Write and Implement ServerTransport

**Files:**
- Create: `src/server/transports/__tests__/server.test.ts`
- Create: `src/server/transports/server.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ServerTransport } from "../server";
import type { Transport, ExecResult } from "~/lib/transport";

function createMockTransport(): Transport {
  return {
    exec: vi.fn(async (): Promise<ExecResult> => ({ exitCode: 0, stdout: "", stderr: "" })),
    openPTY: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(async () => ""),
    fileExists: vi.fn(async () => true),
    destroy: vi.fn(),
  };
}

describe("ServerTransport", () => {
  let mockSsh: Transport;
  let transport: ServerTransport;
  const containerId = "test-container-abc";

  beforeEach(() => {
    mockSsh = createMockTransport();
    transport = new ServerTransport(mockSsh, containerId);
  });

  describe("exec", () => {
    it("wraps commands in docker exec", async () => {
      await transport.exec(["ls", "-la"]);
      expect(mockSsh.exec).toHaveBeenCalledWith(
        ["docker", "exec", containerId, "ls", "-la"],
      );
    });

    it("passes cwd as docker exec -w flag", async () => {
      await transport.exec(["npm", "install"], { cwd: "/home/project" });
      expect(mockSsh.exec).toHaveBeenCalledWith(
        ["docker", "exec", "-w", "/home/project", containerId, "npm", "install"],
      );
    });

    it("passes env vars as docker exec -e flags", async () => {
      await transport.exec(["echo", "hi"], { env: { FOO: "bar" } });
      const call = (mockSsh.exec as any).mock.calls[0][0];
      expect(call).toContain("-e");
      expect(call).toContain("FOO=bar");
      expect(call).toContain(containerId);
    });

    it("handles cwd and env together", async () => {
      await transport.exec(["ls"], { cwd: "/app", env: { NODE_ENV: "test" } });
      const call = (mockSsh.exec as any).mock.calls[0][0];
      expect(call).toContain("-e");
      expect(call).toContain("-w");
      expect(call).toContain("/app");
    });
  });

  describe("writeFile", () => {
    it("base64-encodes content and wraps in docker exec", async () => {
      await transport.writeFile("/tmp/test.txt", "hello world");
      const call = (mockSsh.exec as any).mock.calls[0][0];
      expect(call[0]).toBe("docker");
      expect(call[1]).toBe("exec");
      expect(call).toContain(containerId);
      // Verify the bash -c command contains base64
      const bashCmd = call[call.length - 1];
      expect(bashCmd).toContain("base64");
      expect(bashCmd).toContain("/tmp/test.txt");
    });

    it("shell-escapes file paths with single quotes", async () => {
      await transport.writeFile("/tmp/it's a file.txt", "content");
      const call = (mockSsh.exec as any).mock.calls[0][0];
      const bashCmd = call[call.length - 1];
      expect(bashCmd).toContain("it'\\''s a file.txt");
    });

    it("applies chmod when mode is specified", async () => {
      await transport.writeFile("/tmp/script.sh", "#!/bin/bash", 0o755);
      const call = (mockSsh.exec as any).mock.calls[0][0];
      const bashCmd = call[call.length - 1];
      expect(bashCmd).toContain("chmod");
      expect(bashCmd).toContain("755");
    });
  });

  describe("readFile", () => {
    it("uses docker exec cat", async () => {
      await transport.readFile("/tmp/test.txt");
      expect(mockSsh.exec).toHaveBeenCalledWith(
        ["docker", "exec", containerId, "cat", "/tmp/test.txt"],
      );
    });

    it("throws when file not found", async () => {
      (mockSsh.exec as any).mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" });
      await expect(transport.readFile("/tmp/nope")).rejects.toThrow("File not found");
    });
  });

  describe("fileExists", () => {
    it("uses docker exec test -e", async () => {
      await transport.fileExists("/tmp/test.txt");
      expect(mockSsh.exec).toHaveBeenCalledWith(
        ["docker", "exec", containerId, "test", "-e", "/tmp/test.txt"],
      );
    });

    it("returns false when test -e fails", async () => {
      (mockSsh.exec as any).mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" });
      const result = await transport.fileExists("/tmp/nope");
      expect(result).toBe(false);
    });
  });

  describe("destroy", () => {
    it("delegates to SSH transport", async () => {
      await transport.destroy();
      expect(mockSsh.destroy).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/server/transports/__tests__/server.test.ts
```

Expected: FAIL — `ServerTransport` does not exist yet.

- [ ] **Step 3: Implement ServerTransport**

```typescript
import type { Transport, ExecResult, PTYOptions, PTYSession } from "~/lib/transport";

export class ServerTransport implements Transport {
  constructor(
    private ssh: Transport,
    private containerId: string,
  ) {}

  async exec(
    cmd: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): Promise<ExecResult> {
    const dockerCmd = ["docker", "exec"];

    if (options?.env) {
      for (const [k, v] of Object.entries(options.env)) {
        dockerCmd.push("-e", `${k}=${v}`);
      }
    }
    if (options?.cwd) {
      dockerCmd.push("-w", options.cwd);
    }

    dockerCmd.push(this.containerId, ...cmd);
    return this.ssh.exec(dockerCmd);
  }

  async openPTY(options?: PTYOptions): Promise<PTYSession> {
    const pty = await this.ssh.openPTY({
      cols: options?.cols,
      rows: options?.rows,
    });

    // Write docker exec command into the SSH shell
    pty.stream.write(`docker exec -it ${this.containerId} bash\n`);

    if (options?.cwd) {
      // Wait for docker exec to start, then cd
      await new Promise((r) => setTimeout(r, 500));
      pty.stream.write(`cd ${options.cwd} && clear\n`);
    }

    return pty;
  }

  async writeFile(path: string, content: string, mode?: number): Promise<void> {
    const b64 = Buffer.from(content).toString("base64");
    const escapedPath = path.replace(/'/g, "'\\''");
    const modeCmd = mode ? ` && chmod ${mode.toString(8)} '${escapedPath}'` : "";
    await this.ssh.exec([
      "docker", "exec", this.containerId,
      "bash", "-c", `echo '${b64}' | base64 -d > '${escapedPath}'${modeCmd}`,
    ]);
  }

  async readFile(path: string): Promise<string> {
    const result = await this.ssh.exec(["docker", "exec", this.containerId, "cat", path]);
    if (result.exitCode !== 0) throw new Error(`File not found: ${path}`);
    return result.stdout;
  }

  async fileExists(path: string): Promise<boolean> {
    const result = await this.ssh.exec(["docker", "exec", this.containerId, "test", "-e", path]);
    return result.exitCode === 0;
  }

  async destroy(): Promise<void> {
    await this.ssh.destroy();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/server/transports/__tests__/server.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/transports/server.ts src/server/transports/__tests__/server.test.ts
git commit -m "feat: implement ServerTransport (SSH + docker exec)"
```

## Chunk 3: ServerAgentRuntime Implementation with Tests

### Task 7: Write and Implement ServerAgentRuntime

**Files:**
- Create: `src/server/runtimes/__tests__/server.test.ts`
- Create: `src/server/runtimes/server.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ServerAgentRuntime } from "../server";
import type { Transport, ExecResult } from "~/lib/transport";
import type { SSHConnectionOptions } from "~/server/transports/ssh";

function mockExecResult(stdout = "", exitCode = 0): ExecResult {
  return { exitCode, stdout, stderr: "" };
}

function createMockTransport() {
  return {
    exec: vi.fn(async (): Promise<ExecResult> => mockExecResult()),
    openPTY: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(async () => ""),
    fileExists: vi.fn(async () => true),
    destroy: vi.fn(),
  } satisfies Transport;
}

describe("ServerAgentRuntime", () => {
  const connOpts: SSHConnectionOptions = {
    host: "192.168.1.100",
    port: 22,
    username: "testuser",
    privateKey: "fake-key",
  };

  let mockTransport: ReturnType<typeof createMockTransport>;
  let runtime: ServerAgentRuntime;

  beforeEach(() => {
    mockTransport = createMockTransport();
    runtime = new ServerAgentRuntime(connOpts, () => mockTransport);
  });

  describe("create", () => {
    it("checks docker info, pulls image, runs container, queries port", async () => {
      (mockTransport.exec as any)
        .mockResolvedValueOnce(mockExecResult()) // docker info
        .mockResolvedValueOnce(mockExecResult()) // docker pull
        .mockResolvedValueOnce(mockExecResult("container-id-123")) // docker run
        .mockResolvedValueOnce(mockExecResult("0.0.0.0:32768")); // docker port

      const result = await runtime.create({
        name: "test-agent",
        machineId: "machine-1",
        orgId: "org-abc",
        env: { FOO: "bar" },
        devPort: 3000,
      });

      expect(result.remoteId).toBe("container-id-123");
      expect(result.hostPort).toBe(32768);

      const calls = (mockTransport.exec as any).mock.calls;
      expect(calls[0][0]).toContain("info");
    });

    it("installs docker when docker info fails and sudo is available", async () => {
      (mockTransport.exec as any)
        .mockResolvedValueOnce(mockExecResult("", 1)) // docker info fails
        .mockResolvedValueOnce(mockExecResult()) // sudo -n true succeeds
        .mockResolvedValueOnce(mockExecResult()) // curl install
        .mockResolvedValueOnce(mockExecResult()) // usermod
        .mockResolvedValueOnce(mockExecResult()) // sudo docker pull
        .mockResolvedValueOnce(mockExecResult("cid")) // sudo docker run
        .mockResolvedValueOnce(mockExecResult("0.0.0.0:32768")); // sudo docker port

      const result = await runtime.create({
        name: "test-agent",
        machineId: "machine-1",
        orgId: "org-abc",
        env: {},
        devPort: 3000,
      });

      expect(result.remoteId).toBeDefined();

      // Verify sudo was used after install
      const pullCall = (mockTransport.exec as any).mock.calls[4][0];
      expect(pullCall[0]).toBe("sudo");
    });

    it("throws helpful error when docker missing and no passwordless sudo", async () => {
      (mockTransport.exec as any)
        .mockResolvedValueOnce(mockExecResult("", 1)) // docker info fails
        .mockResolvedValueOnce(mockExecResult("", 1)); // sudo -n true fails

      await expect(runtime.create({
        name: "test", machineId: "m1", orgId: "org1", env: {},
      })).rejects.toThrow("Docker is not installed and passwordless sudo is not available");
    });

    it("creates container without port mapping when no devPort", async () => {
      (mockTransport.exec as any)
        .mockResolvedValueOnce(mockExecResult()) // docker info
        .mockResolvedValueOnce(mockExecResult()) // docker pull
        .mockResolvedValueOnce(mockExecResult("container-id-123")); // docker run (no port query)

      const result = await runtime.create({
        name: "test-agent",
        machineId: "machine-1",
        orgId: "org-abc",
        env: {},
      });

      expect(result.remoteId).toBe("container-id-123");
      expect(result.hostPort).toBeUndefined();
      // Only 3 calls: info, pull, run (no port query)
      expect(mockTransport.exec).toHaveBeenCalledTimes(3);
    });

    it("prefixes container and volume with orgId", async () => {
      (mockTransport.exec as any)
        .mockResolvedValueOnce(mockExecResult()) // docker info
        .mockResolvedValueOnce(mockExecResult()) // docker pull
        .mockResolvedValueOnce(mockExecResult("abc123")); // docker run

      await runtime.create({
        name: "test-agent",
        machineId: "machine-1",
        orgId: "org-xyz",
        env: {},
      });

      const runCall = (mockTransport.exec as any).mock.calls[2][0];
      const cmdStr = runCall.join(" ");
      expect(cmdStr).toContain("--name org-xyz-test-agent");
      expect(cmdStr).toContain("dindang-org-xyz-test-agent");
    });
  });

  describe("stop", () => {
    it("stops the container", async () => {
      await runtime.stop("container-id-123");
      const call = (mockTransport.exec as any).mock.calls[0][0];
      expect(call).toContain("stop");
      expect(call).toContain("container-id-123");
    });
  });

  describe("remove", () => {
    it("removes container and volume", async () => {
      (mockTransport.exec as any)
        .mockResolvedValueOnce(mockExecResult("/org-xyz-test-agent")) // docker inspect
        .mockResolvedValueOnce(mockExecResult()) // docker rm -f
        .mockResolvedValueOnce(mockExecResult()); // docker volume rm

      await runtime.remove("container-id-123");

      const calls = (mockTransport.exec as any).mock.calls;
      const allCmds = calls.map((c: any[]) => c[0].join(" "));
      expect(allCmds.some((c: string) => c.includes("rm -f"))).toBe(true);
      expect(allCmds.some((c: string) => c.includes("volume rm"))).toBe(true);
    });
  });

  describe("redeploy", () => {
    it("stops, removes container (keeps volume), creates new", async () => {
      (mockTransport.exec as any)
        .mockResolvedValueOnce(mockExecResult()) // docker stop
        .mockResolvedValueOnce(mockExecResult()) // docker rm
        .mockResolvedValueOnce(mockExecResult()) // docker pull
        .mockResolvedValueOnce(mockExecResult("new-cid")) // docker run
        .mockResolvedValueOnce(mockExecResult("0.0.0.0:32769")); // docker port

      const result = await runtime.redeploy("old-cid", {
        name: "test-agent",
        machineId: "machine-1",
        orgId: "org-abc",
        env: {},
        devPort: 3000,
      });

      expect(result.remoteId).toBe("new-cid");
      expect(result.hostPort).toBe(32769);

      // Verify volume rm was NOT called
      const calls = (mockTransport.exec as any).mock.calls;
      const allCmds = calls.map((c: any[]) => c[0].join(" "));
      expect(allCmds.some((c: string) => c.includes("volume rm"))).toBe(false);
    });
  });

  describe("getTransport", () => {
    it("returns a ServerTransport wrapping SSH", async () => {
      const transport = await runtime.getTransport("container-id");
      // Verify it's usable (calls docker exec via ssh)
      await transport.exec(["echo", "hi"]);
      const call = (mockTransport.exec as any).mock.calls[0][0];
      expect(call[0]).toBe("docker");
      expect(call[1]).toBe("exec");
    });
  });

  describe("isRunning", () => {
    it("returns true when docker inspect shows running", async () => {
      (mockTransport.exec as any).mockResolvedValueOnce(mockExecResult("true"));
      expect(await runtime.isRunning("container-id")).toBe(true);
    });

    it("returns false when docker inspect fails", async () => {
      (mockTransport.exec as any).mockResolvedValueOnce(mockExecResult("", 1));
      expect(await runtime.isRunning("container-id")).toBe(false);
    });

    it("returns false when SSH connection fails", async () => {
      (mockTransport.exec as any).mockRejectedValueOnce(new Error("SSH timeout"));
      expect(await runtime.isRunning("container-id")).toBe(false);
    });
  });

  describe("error handling", () => {
    it("throws when docker install script fails", async () => {
      (mockTransport.exec as any)
        .mockResolvedValueOnce(mockExecResult("", 1)) // docker info fails
        .mockResolvedValueOnce(mockExecResult()) // sudo -n true succeeds
        .mockResolvedValueOnce(mockExecResult("", 1)); // curl install fails

      await expect(runtime.create({
        name: "test", machineId: "m1", orgId: "org1", env: {},
      })).rejects.toThrow("Failed to install Docker");
    });

    it("throws when container create fails", async () => {
      (mockTransport.exec as any)
        .mockResolvedValueOnce(mockExecResult()) // docker info
        .mockResolvedValueOnce(mockExecResult()) // docker pull
        .mockResolvedValueOnce(mockExecResult("", 1)); // docker run fails

      await expect(runtime.create({
        name: "test", machineId: "m1", orgId: "org1", env: {},
      })).rejects.toThrow("Failed to create container");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/server/runtimes/__tests__/server.test.ts
```

Expected: FAIL — `ServerAgentRuntime` does not exist.

- [ ] **Step 3: Implement ServerAgentRuntime**

```typescript
import type {
  AgentRuntime,
  AgentRuntimeOptions,
  Transport,
} from "~/lib/transport";
import { SSHTransport, type SSHConnectionOptions } from "~/server/transports/ssh";
import { ServerTransport } from "~/server/transports/server";

const IMAGE = "node:22-slim";
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

type TransportFactory = (opts: SSHConnectionOptions) => Transport;

export class ServerAgentRuntime implements AgentRuntime {
  private connectionOptions: SSHConnectionOptions;
  private createTransport: TransportFactory;
  private dockerReady = false;
  private useSudo = false;

  constructor(connectionOptions: SSHConnectionOptions, createTransport?: TransportFactory) {
    this.connectionOptions = connectionOptions;
    this.createTransport = createTransport ?? ((opts) => new SSHTransport(opts));
  }

  private docker(cmd: string[]): string[] {
    return this.useSudo ? ["sudo", "docker", ...cmd] : ["docker", ...cmd];
  }

  private async ensureDocker(transport: Transport): Promise<void> {
    if (this.dockerReady) return;

    const result = await transport.exec(["docker", "info"]);
    if (result.exitCode === 0) {
      this.dockerReady = true;
      return;
    }

    // Docker not found — check if we can install it
    const sudoCheck = await transport.exec(["sudo", "-n", "true"]);
    if (sudoCheck.exitCode !== 0) {
      throw new Error(
        "Docker is not installed and passwordless sudo is not available. " +
        "Either install Docker manually on the server, or enable passwordless sudo: " +
        `echo '${this.connectionOptions.username} ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/${this.connectionOptions.username}`,
      );
    }

    // Install Docker
    const installResult = await transport.exec(["bash", "-c", "curl -fsSL https://get.docker.com | sh"]);
    if (installResult.exitCode !== 0) {
      throw new Error(
        "Failed to install Docker. Install it manually on the server: curl -fsSL https://get.docker.com | sh",
      );
    }
    await transport.exec(["sudo", "usermod", "-aG", "docker", this.connectionOptions.username]);

    // After install, use sudo for the remainder of this session
    // (group change doesn't take effect until new login)
    this.useSudo = true;
    this.dockerReady = true;
  }

  private containerName(options: AgentRuntimeOptions): string {
    return `${options.orgId}-${options.name}`;
  }

  private volumeName(options: AgentRuntimeOptions): string {
    return `dindang-${options.orgId}-${options.name}`;
  }

  async create(options: AgentRuntimeOptions): Promise<{ remoteId: string; hostPort?: number }> {
    const transport = this.createTransport(this.connectionOptions);
    try {
      await this.ensureDocker(transport);

      // Pull image
      await transport.exec(this.docker(["pull", IMAGE]));

      // Build docker run command
      const name = this.containerName(options);
      const volume = this.volumeName(options);
      const runCmd = this.docker([
        "run", "-d",
        "--name", name,
        "-v", `${volume}:/home`,
      ]);

      if (options.devPort) {
        runCmd.push("-p", `0:${options.devPort}`);
      }

      for (const [k, v] of Object.entries(options.env)) {
        if (!ENV_KEY_RE.test(k)) throw new Error(`Invalid environment variable name: ${k}`);
        runCmd.push("-e", `${k}=${v}`);
      }

      runCmd.push(IMAGE, "bash", "-c", "trap 'exit 0' TERM; while true; do sleep 1; done");

      const result = await transport.exec(runCmd);
      if (result.exitCode !== 0) {
        throw new Error(`Failed to create container: ${result.stderr || result.stdout}`);
      }
      const remoteId = result.stdout.trim();

      // Query host port
      let hostPort: number | undefined;
      if (options.devPort) {
        const portResult = await transport.exec(
          this.docker(["port", name, String(options.devPort)]),
        );
        const match = portResult.stdout.match(/:(\d+)/);
        if (match) hostPort = parseInt(match[1]!, 10);
      }

      return { remoteId, hostPort };
    } finally {
      await transport.destroy();
    }
  }

  async redeploy(remoteId: string, options: AgentRuntimeOptions): Promise<{ remoteId: string; hostPort?: number }> {
    const transport = this.createTransport(this.connectionOptions);
    try {
      const name = this.containerName(options);
      const volume = this.volumeName(options);

      // Stop and remove old container (keep volume)
      await transport.exec(this.docker(["stop", name])).catch(() => {});
      await transport.exec(this.docker(["rm", "-f", name]));

      // Pull latest image
      await transport.exec(this.docker(["pull", IMAGE]));

      // Create new container with same volume
      const runCmd = this.docker([
        "run", "-d",
        "--name", name,
        "-v", `${volume}:/home`,
      ]);

      if (options.devPort) {
        runCmd.push("-p", `0:${options.devPort}`);
      }

      for (const [k, v] of Object.entries(options.env)) {
        if (!ENV_KEY_RE.test(k)) throw new Error(`Invalid environment variable name: ${k}`);
        runCmd.push("-e", `${k}=${v}`);
      }

      runCmd.push(IMAGE, "bash", "-c", "trap 'exit 0' TERM; while true; do sleep 1; done");

      const result = await transport.exec(runCmd);
      const newRemoteId = result.stdout.trim();

      let hostPort: number | undefined;
      if (options.devPort) {
        const portResult = await transport.exec(
          this.docker(["port", name, String(options.devPort)]),
        );
        const match = portResult.stdout.match(/:(\d+)/);
        if (match) hostPort = parseInt(match[1]!, 10);
      }

      return { remoteId: newRemoteId, hostPort };
    } finally {
      await transport.destroy();
    }
  }

  async stop(remoteId: string): Promise<void> {
    const transport = this.createTransport(this.connectionOptions);
    try {
      await transport.exec(this.docker(["stop", remoteId]));
    } finally {
      await transport.destroy();
    }
  }

  async remove(remoteId: string): Promise<void> {
    const transport = this.createTransport(this.connectionOptions);
    try {
      const inspectResult = await transport.exec(
        this.docker(["inspect", "--format", "{{.Name}}", remoteId]),
      );
      const containerName = inspectResult.stdout.trim().replace(/^\//, "");

      await transport.exec(this.docker(["rm", "-f", remoteId])).catch(() => {});

      if (containerName) {
        await transport.exec(
          this.docker(["volume", "rm", `dindang-${containerName}`]),
        ).catch(() => {});
      }
    } finally {
      await transport.destroy();
    }
  }

  async getTransport(remoteId: string): Promise<Transport> {
    const ssh = this.createTransport(this.connectionOptions);
    return new ServerTransport(ssh, remoteId);
  }

  async isRunning(remoteId: string): Promise<boolean> {
    const transport = this.createTransport(this.connectionOptions);
    try {
      const result = await transport.exec(
        this.docker(["inspect", "--format", "{{.State.Running}}", remoteId]),
      );
      return result.stdout.trim() === "true";
    } catch {
      return false;
    } finally {
      await transport.destroy();
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/server/runtimes/__tests__/server.test.ts
```

Expected: PASS (adjust mock sequences if needed)

- [ ] **Step 5: Commit**

```bash
git add src/server/runtimes/server.ts src/server/runtimes/__tests__/server.test.ts
git commit -m "feat: implement ServerAgentRuntime (remote Docker over SSH)"
```

## Chunk 4: Wire Up and Integration

### Task 8: Wire ServerAgentRuntime into Machine Registry

**Files:**
- Modify: `src/server/machine-registry.ts`

- [ ] **Step 1: Import and wire up**

Add the import:

```typescript
import { ServerAgentRuntime } from "~/server/runtimes/server";
```

Replace the `"server"` placeholder in `getRuntimeForMachine`:

```typescript
if (machine.type === "server") {
  let credential: string | undefined;
  if (machine.encryptedCredential) {
    const key = deriveKey(machine.orgId);
    credential = decrypt(machine.encryptedCredential, key);
  }
  return new ServerAgentRuntime({
    host: machine.host!,
    port: machine.port ?? 22,
    username: machine.username!,
    ...(machine.authMethod === "key"
      ? { privateKey: credential }
      : { password: credential }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/machine-registry.ts
git commit -m "feat: wire ServerAgentRuntime into machine registry"
```

### Task 9: Update .env.example with DINDANG_CALLBACK_URL

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add DINDANG_CALLBACK_URL**

Add to `.env.example`:

```
DINDANG_CALLBACK_URL=http://localhost:3000
```

This is required for Server machines so that Claude Code hooks inside remote containers can reach the dindang server.

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add DINDANG_CALLBACK_URL to .env.example"
```

### Task 10: Run All Tests and Verify

- [ ] **Step 1: Run full test suite**

```bash
npm run test
```

Expected: All tests pass including new ServerTransport and ServerAgentRuntime tests.

- [ ] **Step 2: Start dev server and verify E2E**

```bash
npm run dev
```

1. Navigate to Settings > Machines
2. Verify "Server (managed Docker)" and "Terminal (direct SSH)" types appear
3. Create a Server machine pointing to a test SSH target (if available)
4. Create an agent on the Server machine and verify container creation

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve integration issues with server machine type"
```
