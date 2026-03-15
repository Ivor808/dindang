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

    // Write docker exec command into the SSH shell — uses tmux so the session
    // survives WebSocket disconnects (tmux detaches instead of killing the process).
    // -d on attach-session detaches stale clients so tmux uses the current terminal size.
    const cwd = options?.cwd ?? "/home/dev";
    const tmuxCmd = `tmux has-session -t main 2>/dev/null && tmux attach-session -dt main || tmux new-session -s main -c '${cwd}'`;
    pty.stream.write(`docker exec -it -u dev -w ${cwd} -e HOME=/home/dev -e PATH=/home/dev/.local/bin:/usr/local/bin:/usr/bin:/bin ${this.containerId} bash -lc '${tmuxCmd}'\n`);

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
