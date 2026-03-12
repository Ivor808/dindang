import type { Agent } from "./types";

export interface CreateAgentOptions {
  name: string;
  projectId: string;
  repoUrl: string;
  githubToken: string;
  anthropicApiKey: string;
  setupCommand?: string;
  dindangHost: string;
}

export interface DeploymentProvider {
  create(options: CreateAgentOptions): Promise<Agent>;
  exec(nameOrId: string, command: string): Promise<void>;
  stop(nameOrId: string): Promise<void>;
  remove(nameOrId: string): Promise<void>;
  getStatus(nameOrId: string): Promise<Agent>;
  getLogs(nameOrId: string): Promise<string>;
  list(): Promise<Agent[]>;
}
