import type { Agent } from "./types";

export interface DeploymentProvider {
  create(name: string): Promise<Agent>;
  start(id: string, command: string): Promise<void>;
  stop(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  getStatus(id: string): Promise<Agent>;
  getLogs(id: string): AsyncIterable<string>;
  list(): Promise<Agent[]>;
}
