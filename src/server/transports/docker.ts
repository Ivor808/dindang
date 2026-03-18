import Docker from "dockerode";
import { PassThrough } from "stream";
import type { Transport, ExecResult, PTYOptions, PTYSession } from "~/lib/transport";

export class DockerTransport implements Transport {
  constructor(private container: Docker.Container) {}

  async exec(cmd: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<ExecResult> {
    const exec = await this.container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      ...(options?.cwd && { WorkingDir: options.cwd }),
      ...(options?.env && { Env: Object.entries(options.env).map(([k, v]) => `${k}=${v}`) }),
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    return new Promise((resolve) => {
      // Docker multiplexes stdout/stderr with 8-byte headers when Tty is false.
      // Demux into separate streams to get clean output.
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      this.container.modem.demuxStream(stream, stdout, stderr);

      stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      stream.on("end", async () => {
        const info = await exec.inspect();
        resolve({
          exitCode: info.ExitCode ?? 1,
          stdout: Buffer.concat(stdoutChunks).toString(),
          stderr: Buffer.concat(stderrChunks).toString(),
        });
      });
    });
  }

  async openPTY(options?: PTYOptions): Promise<PTYSession> {
    const cwd = options?.cwd ?? "/home/dev";
    const session = (options?.sessionName ?? "main").replace(/'/g, "'\\''");
    // -A: attach if session exists, create if not. No bash wrapper needed.
    // tmux spawns the default shell (bash) for new sessions.
    const exec = await this.container.exec({
      Cmd: ["tmux", "new-session", "-As", session, "-c", cwd],
      User: "dev",
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Env: [
        "TERM=xterm-256color",
        "HOME=/home/dev",
        "LANG=en_US.UTF-8",
        "LC_ALL=en_US.UTF-8",
        `PATH=/home/dev/.local/bin:/usr/local/bin:/usr/bin:/bin`,
        ...(options?.env ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`) : []),
      ],
      WorkingDir: cwd,
    });

    const stream = await exec.start({ hijack: true, stdin: true, Tty: true });

    if (options?.cols && options?.rows) {
      await exec.resize({ w: options.cols, h: options.rows });
    }

    return {
      stream,
      resize: (cols, rows) => { exec.resize({ w: cols, h: rows }); },
      close: () => { stream.end(); },
    };
  }

  async writeFile(path: string, content: string, mode?: number): Promise<void> {
    const b64 = Buffer.from(content).toString("base64");
    const escapedPath = path.replace(/'/g, "'\\''");
    const modeCmd = mode ? ` && chmod ${mode.toString(8)} '${escapedPath}'` : "";
    await this.exec(["bash", "-c", `echo '${b64}' | base64 -d > '${escapedPath}'${modeCmd}`]);
  }

  async readFile(path: string): Promise<string> {
    const result = await this.exec(["cat", path]);
    if (result.exitCode !== 0) throw new Error(`File not found: ${path}`);
    return result.stdout;
  }

  async fileExists(path: string): Promise<boolean> {
    const result = await this.exec(["test", "-e", path]);
    return result.exitCode === 0;
  }

  async destroy(): Promise<void> {
    // no-op — container lifecycle managed by DockerAgentRuntime
  }
}
