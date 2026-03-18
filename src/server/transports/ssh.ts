import { Client } from "ssh2";
import type {
  Transport,
  ExecResult,
  PTYOptions,
  PTYSession,
} from "~/lib/transport";

export interface SSHConnectionOptions {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
}

export function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateEnvKey(key: string): string {
  if (!ENV_KEY_RE.test(key)) {
    throw new Error(`Invalid environment variable name: ${key}`);
  }
  return key;
}

export class SSHTransport implements Transport {
  private client: Client;
  private connected = false;

  constructor(private options: SSHConnectionOptions) {
    this.client = new Client();
  }

  private async connect(): Promise<void> {
    if (this.connected) return;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("SSH handshake timeout")),
        30000,
      );
      this.client.on("ready", () => {
        clearTimeout(timeout);
        this.connected = true;
        resolve();
      });
      this.client.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      this.client.connect({
        host: this.options.host,
        port: this.options.port,
        username: this.options.username,
        privateKey: this.options.privateKey,
        password: this.options.password,
        keepaliveInterval: 10000,
        agentForward: false,
      });
    });
  }

  async exec(
    cmd: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): Promise<ExecResult> {
    await this.connect();

    const fullCmd = options?.cwd
      ? `cd ${shellEscape(options.cwd)} && ${cmd.map(shellEscape).join(" ")}`
      : cmd.map(shellEscape).join(" ");

    const envPrefix = options?.env
      ? Object.entries(options.env)
          .map(([k, v]) => `${validateEnvKey(k)}=${shellEscape(v)}`)
          .join(" ") + " "
      : "";

    return new Promise((resolve, reject) => {
      this.client.exec(`${envPrefix}${fullCmd}`, (err, channel) => {
        if (err) return reject(err);
        let stdout = "";
        let stderr = "";
        channel.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        channel.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        channel.on("close", (code: number) => {
          resolve({ exitCode: code ?? 1, stdout, stderr });
        });
      });
    });
  }

  async openPTY(options?: PTYOptions): Promise<PTYSession> {
    await this.connect();

    return new Promise((resolve, reject) => {
      this.client.shell(
        {
          term: "xterm-256color",
          cols: options?.cols ?? 80,
          rows: options?.rows ?? 24,
        },
        (err, stream) => {
          if (err) return reject(err);

          // Set env vars and cd to working directory
          if (options?.env) {
            for (const [k, v] of Object.entries(options.env)) {
              stream.write(`export ${validateEnvKey(k)}=${shellEscape(v)}\n`);
            }
          }
          if (options?.cwd) {
            stream.write(`cd ${shellEscape(options.cwd)}\n`);
          }
          // Clear the screen after setup commands
          stream.write("clear\n");

          resolve({
            stream,
            resize: (cols, rows) => {
              stream.setWindow(rows, cols, 0, 0);
            },
            close: () => {
              stream.close();
            },
          });
        },
      );
    });
  }

  async writeFile(path: string, content: string, mode?: number): Promise<void> {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);
        const writeStream = sftp.createWriteStream(path, {
          mode: mode ?? 0o644,
        });
        writeStream.on("close", () => {
          sftp.end();
          resolve();
        });
        writeStream.on("error", (e: Error) => {
          sftp.end();
          reject(e);
        });
        writeStream.end(content);
      });
    });
  }

  async readFile(path: string): Promise<string> {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);
        sftp.readFile(path, "utf8", (readErr, data) => {
          sftp.end();
          if (readErr) return reject(readErr);
          resolve(data as unknown as string);
        });
      });
    });
  }

  async fileExists(path: string): Promise<boolean> {
    await this.connect();
    return new Promise((resolve) => {
      this.client.sftp((err, sftp) => {
        if (err) return resolve(false);
        sftp.stat(path, (statErr) => {
          sftp.end();
          resolve(!statErr);
        });
      });
    });
  }

  async destroy(): Promise<void> {
    this.client.end();
    this.connected = false;
  }
}
