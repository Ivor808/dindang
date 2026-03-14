export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface PTYOptions {
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  cwd?: string;
}

export interface PTYSession {
  stream: NodeJS.ReadWriteStream;
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface Transport {
  exec(cmd: string[], options?: { cwd?: string; env?: Record<string, string> }): Promise<ExecResult>;
  openPTY(options?: PTYOptions): Promise<PTYSession>;
  writeFile(path: string, content: string, mode?: number): Promise<void>;
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  destroy(): Promise<void>;
}

export interface AgentRuntimeOptions {
  name: string;
  machineId: string;
  orgId: string;
  env: Record<string, string>;
  devPort?: number;
}

export interface AgentRuntime {
  create(options: AgentRuntimeOptions): Promise<{ remoteId: string; hostPort?: number }>;
  redeploy?(remoteId: string, options: AgentRuntimeOptions): Promise<{ remoteId: string; hostPort?: number }>;
  stop(remoteId: string): Promise<void>;
  remove(remoteId: string): Promise<void>;
  getTransport(remoteId: string): Promise<Transport>;
  isRunning(remoteId: string): Promise<boolean>;
}
