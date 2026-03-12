import Docker from "dockerode";
import type { DeploymentProvider } from "./provider";
import type { Agent, AgentStatus } from "./types";

const LABEL = "dindang.managed";
const IMAGE = "debian:bookworm-slim";

const docker = new Docker();

function containerToAgent(container: Docker.ContainerInfo): Agent {
  const state = container.State;
  const exitedClean = container.Status?.includes("Exited (0)");

  let status: AgentStatus;
  if (state === "running") {
    status = "running";
  } else if (state === "created") {
    status = "idle";
  } else if (state === "exited" && exitedClean) {
    status = "done";
  } else if (state === "exited") {
    status = "error";
  } else {
    status = "idle";
  }

  return {
    id: container.Id,
    name: container.Names[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12),
    status,
    command: container.Command || undefined,
    createdAt: new Date(container.Created * 1000).toISOString(),
  };
}

function inspectToAgent(info: Docker.ContainerInspectInfo): Agent {
  const state = info.State;
  let status: AgentStatus;

  if (state.Running) {
    status = "running";
  } else if (state.Status === "created") {
    status = "idle";
  } else if (state.ExitCode === 0 && state.Status === "exited") {
    status = "done";
  } else if (state.Status === "exited") {
    status = "error";
  } else {
    status = "idle";
  }

  return {
    id: info.Id,
    name: info.Name.replace(/^\//, ""),
    status,
    command: info.Config.Cmd?.join(" ") || undefined,
    createdAt: info.Created,
  };
}

export const dockerProvider: DeploymentProvider = {
  async create(name: string): Promise<Agent> {
    // Pull image if not present
    try {
      const stream = await docker.pull(IMAGE);
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (err: Error | null) =>
          err ? reject(err) : resolve()
        );
      });
    } catch {
      // Image may already exist locally
    }

    const container = await docker.createContainer({
      Image: IMAGE,
      name,
      Labels: { [LABEL]: "true" },
      Tty: true,
      OpenStdin: true,
      Cmd: ["/bin/bash"],
    });

    const info = await container.inspect();
    return inspectToAgent(info);
  },

  async start(nameOrId: string, command: string): Promise<void> {
    const container = docker.getContainer(nameOrId);
    const info = await container.inspect();
    const name = info.Name.replace(/^\//, "");

    // Remove existing container and recreate with the command
    try {
      await container.stop();
    } catch {
      // may already be stopped
    }
    await container.remove();

    const newContainer = await docker.createContainer({
      Image: IMAGE,
      name,
      Labels: { [LABEL]: "true" },
      Tty: true,
      Cmd: ["bash", "-c", command],
    });
    await newContainer.start();
  },

  async stop(nameOrId: string): Promise<void> {
    const container = docker.getContainer(nameOrId);
    await container.stop();
  },

  async remove(nameOrId: string): Promise<void> {
    const container = docker.getContainer(nameOrId);
    try {
      await container.stop();
    } catch {
      // may already be stopped
    }
    await container.remove();
  },

  async getStatus(nameOrId: string): Promise<Agent> {
    const container = docker.getContainer(nameOrId);
    const info = await container.inspect();
    return inspectToAgent(info);
  },

  async *getLogs(nameOrId: string): AsyncIterable<string> {
    const container = docker.getContainer(nameOrId);
    const buffer = await container.logs({
      follow: false,
      stdout: true,
      stderr: true,
      tail: 200,
    });

    // When Tty is true, logs come back as a single Buffer
    const text = buffer.toString();
    if (text) {
      yield text;
    }
  },

  async list(): Promise<Agent[]> {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: [LABEL] },
    });
    return containers.map(containerToAgent);
  },
};
