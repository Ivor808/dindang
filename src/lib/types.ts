export type AgentStatus = "provisioning" | "ready" | "busy" | "error";
export type MachineStatus = "connected" | "unreachable" | "unknown";
export type MachineType = "server" | "terminal" | "local";
export type OrgRole = "owner" | "admin" | "member";

export interface Agent {
  id: string;
  name: string;
  orgId: string;
  projectId: string;
  machineId: string;
  createdBy: string;
  remoteId: string;
  workDir: string;
  status: AgentStatus;
  errorMessage?: string;
  color?: string;
  busySince?: string;
  createdAt: string;
  hostPort?: number;
  previewUrl?: string;
}

export interface Machine {
  id: string;
  orgId: string;
  name: string;
  type: MachineType;
  host?: string;
  port?: number;
  username?: string;
  authMethod?: "key" | "password";
  hostKeyFingerprint?: string;
  enabled: boolean;
  status: MachineStatus;
  createdAt: string;
}

export type AiCli = "claude" | "codex" | "none";

export interface Project {
  id: string;
  orgId: string;
  name: string;
  repoUrl: string;
  setupCommand?: string;
  aiCli: AiCli;
  devPort?: number;
  isDefault: boolean;
}
