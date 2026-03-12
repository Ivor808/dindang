export type AgentStatus = "idle" | "running" | "done" | "error";

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  command?: string;
  createdAt: string;
}
