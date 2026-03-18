import type { Transport, ExecResult, PTYOptions, PTYSession } from "~/lib/transport";
import { shellEscape } from "./ssh";

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

    // Exec into container and run tmux directly (no bash wrapper).
    // tmux new-session spawns a login shell itself, so we don't need bash -l.
    const cwd = options?.cwd ?? "/home/dev";
    const session = options?.sessionName ?? "main";
    pty.stream.write(
      `docker exec -it -u dev -w ${shellEscape(cwd)} -e HOME=/home/dev -e TERM=xterm-256color -e LANG=en_US.UTF-8 -e LC_ALL=en_US.UTF-8 -e PATH=/home/dev/.local/bin:/usr/local/bin:/usr/bin:/bin ${shellEscape(this.containerId)} tmux new-session -As ${shellEscape(session)} -c ${shellEscape(cwd)}\n`
    );

    return pty;
  }

  async writeFile(path: string, content: string, mode?: number): Promise<void> {
    const b64 = Buffer.from(content).toString("base64");
    const escapedPath = shellEscape(path);
    const modeCmd = mode ? ` && chmod ${mode.toString(8)} ${escapedPath}` : "";
    await this.ssh.exec([
      "docker", "exec", this.containerId,
      "bash", "-c", `echo '${b64}' | base64 -d > ${escapedPath}${modeCmd}`,
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
