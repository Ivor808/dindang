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
  createdAt: string;
  hostPort?: number;
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

export interface Project {
  id: string;
  orgId: string;
  name: string;
  repoUrl: string;
  setupCommand?: string;
  devPort?: number;
  isDefault: boolean;
}
