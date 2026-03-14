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
