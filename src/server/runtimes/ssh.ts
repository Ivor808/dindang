import type {
  AgentRuntime,
  AgentRuntimeOptions,
  Transport,
} from "~/lib/transport";
import { SSHTransport, type SSHConnectionOptions } from "~/server/transports/ssh";

export class SSHAgentRuntime implements AgentRuntime {
  constructor(private connectionOptions: SSHConnectionOptions) {}

  async create(
    options: AgentRuntimeOptions,
  ): Promise<{ remoteId: string; hostPort?: number }> {
    const transport = new SSHTransport(this.connectionOptions);
    try {
      // Write environment variables to ~/.dindang-env
      const envContent = Object.entries(options.env)
        .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
        .join("\n");
      await transport.writeFile("/root/.dindang-env", envContent, 0o600);

      // Source from bashrc if not already
      const bashrc = await transport.readFile("/root/.bashrc").catch(() => "");
      if (!bashrc.includes(".dindang-env")) {
        await transport.writeFile(
          "/root/.bashrc",
          bashrc +
            "\n[ -f ~/.dindang-env ] && source ~/.dindang-env\n",
        );
      }
    } finally {
      await transport.destroy();
    }

    return { remoteId: `ssh-${options.name}`, hostPort: options.devPort };
  }

  async stop(_remoteId: string): Promise<void> {
    const transport = new SSHTransport(this.connectionOptions);
    try {
      await transport.exec(["pkill", "-f", "claude"]).catch(() => {});
    } finally {
      await transport.destroy();
    }
  }

  async remove(_remoteId: string): Promise<void> {
    const transport = new SSHTransport(this.connectionOptions);
    try {
      await transport.exec(["pkill", "-f", "claude"]).catch(() => {});
      await transport.exec(["rm", "-f", "/root/.dindang-env"]);
    } finally {
      await transport.destroy();
    }
  }

  async getTransport(_remoteId: string): Promise<Transport> {
    return new SSHTransport(this.connectionOptions);
  }

  async isRunning(_remoteId: string): Promise<boolean> {
    const transport = new SSHTransport(this.connectionOptions);
    try {
      const result = await transport.exec(["echo", "ok"]);
      return result.exitCode === 0;
    } catch {
      return false;
    } finally {
      await transport.destroy();
    }
  }
}
