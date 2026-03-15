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
        "--label", "dindang.managed=true",
        "--label", `dindang.agent=${options.name}`,
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
        "--label", "dindang.managed=true",
        "--label", `dindang.agent=${options.name}`,
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
