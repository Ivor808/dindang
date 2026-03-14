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
        .mockResolvedValueOnce(mockExecResult("container-id-123")); // docker run

      const result = await runtime.create({
        name: "test-agent",
        machineId: "machine-1",
        orgId: "org-abc",
        env: {},
      });

      expect(result.remoteId).toBe("container-id-123");
      expect(result.hostPort).toBeUndefined();
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

      const calls = (mockTransport.exec as any).mock.calls;
      const allCmds = calls.map((c: any[]) => c[0].join(" "));
      expect(allCmds.some((c: string) => c.includes("volume rm"))).toBe(false);
    });
  });

  describe("getTransport", () => {
    it("returns a ServerTransport wrapping SSH", async () => {
      const transport = await runtime.getTransport("container-id");
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
