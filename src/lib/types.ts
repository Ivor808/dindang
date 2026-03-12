export type AgentStatus = "provisioning" | "ready" | "busy" | "error";

export interface Agent {
  id: string;
  name: string;
  projectId: string;
  machineId: string;
  containerId: string;
  status: AgentStatus;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  repoUrl: string;
  setupCommand?: string;
  isDefault: boolean;
}

export interface Settings {
  anthropicApiKey: string;
  githubToken: string;
  projects: Project[];
}
