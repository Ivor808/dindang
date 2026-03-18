import Docker from "dockerode";
import type { AgentRuntime, AgentRuntimeOptions, Transport } from "~/lib/transport";
import { DockerTransport } from "~/server/transports/docker";

const LABEL = "dindang.managed";
const IMAGE = "node:22-slim";
const NETWORK = process.env.DINDANG_DOCKER_NETWORK || "";

export class DockerAgentRuntime implements AgentRuntime {
  private docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker ?? new Docker();
  }

  async create(options: AgentRuntimeOptions): Promise<{ remoteId: string; hostPort?: number }> {
    const stream = await this.docker.pull(IMAGE);
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err: Error | null) =>
        err ? reject(err) : resolve()
      );
    });

    const envArr = Object.entries(options.env).map(([k, v]) => `${k}=${v}`);
    const volumeName = `dindang-${options.name}`;

    const portBindings: Record<string, { HostPort: string }[]> = {};
    const exposedPorts: Record<string, object> = {};
    if (options.devPort) {
      const portKey = `${options.devPort}/tcp`;
      exposedPorts[portKey] = {};
      portBindings[portKey] = [{ HostPort: "0" }]; // 0 = let Docker pick a free port
    }

    const container = await this.docker.createContainer({
      Image: IMAGE,
      name: options.name,
      Labels: { [LABEL]: "true", "dindang.agent": options.name },
      Tty: true,
      OpenStdin: true,
      Env: envArr,
      ExposedPorts: exposedPorts,
      Cmd: ["bash", "-c", "trap 'exit 0' TERM; while true; do sleep 1; done"],
      HostConfig: {
        Binds: [`${volumeName}:/home`, "/var/run/docker.sock:/var/run/docker.sock"],
        NetworkMode: NETWORK || undefined,
        PortBindings: portBindings,
      },
    });
    await container.start();

    const info = await container.inspect();
    let hostPort: number | undefined;
    if (options.devPort) {
      const binding = info.NetworkSettings?.Ports?.[`${options.devPort}/tcp`];
      if (binding?.[0]?.HostPort) {
        hostPort = parseInt(binding[0].HostPort, 10);
      }
    }
    return { remoteId: info.Id, hostPort };
  }

  async redeploy(remoteId: string, options: AgentRuntimeOptions): Promise<{ remoteId: string; hostPort?: number }> {
    const oldInfo = await this.docker.getContainer(remoteId).inspect();
    const oldName = oldInfo.Name.replace(/^\//, "");
    const volumeName = `dindang-${oldName}`;

    try { await this.docker.getContainer(remoteId).stop(); } catch { /* may already be stopped */ }
    await this.docker.getContainer(remoteId).remove();

    const envArr = Object.entries(options.env).map(([k, v]) => `${k}=${v}`);

    const portBindings: Record<string, { HostPort: string }[]> = {};
    const exposedPorts: Record<string, object> = {};
    if (options.devPort) {
      const portKey = `${options.devPort}/tcp`;
      exposedPorts[portKey] = {};
      portBindings[portKey] = [{ HostPort: "0" }];
    }

    const container = await this.docker.createContainer({
      Image: IMAGE,
      name: oldName,
      Labels: { [LABEL]: "true", "dindang.agent": oldName },
      Tty: true,
      OpenStdin: true,
      Env: envArr,
      ExposedPorts: exposedPorts,
      Cmd: ["bash", "-c", "trap 'exit 0' TERM; while true; do sleep 1; done"],
      HostConfig: {
        Binds: [`${volumeName}:/home`, "/var/run/docker.sock:/var/run/docker.sock"],
        NetworkMode: NETWORK || undefined,
        PortBindings: portBindings,
      },
    });
    await container.start();

    const info = await container.inspect();
    let hostPort: number | undefined;
    if (options.devPort) {
      const binding = info.NetworkSettings?.Ports?.[`${options.devPort}/tcp`];
      if (binding?.[0]?.HostPort) {
        hostPort = parseInt(binding[0].HostPort, 10);
      }
    }
    return { remoteId: info.Id, hostPort };
  }

  async stop(remoteId: string): Promise<void> {
    await this.docker.getContainer(remoteId).stop();
  }

  async remove(remoteId: string): Promise<void> {
    const container = this.docker.getContainer(remoteId);
    let volumeName: string | undefined;
    let agentName: string | undefined;
    try {
      const info = await container.inspect();
      const name = info.Name.replace(/^\//, "");
      volumeName = `dindang-${name}`;
      agentName = name;
    } catch { /* container may not exist */ }
    try { await container.stop(); } catch { /* may already be stopped */ }
    await container.remove();
    if (volumeName) {
      try { await this.docker.getVolume(volumeName).remove(); } catch { /* volume may not exist */ }
    }
    // Clean up any Docker Compose containers the agent created
    if (agentName) {
      try {
        const composeContainers = await this.docker.listContainers({
          all: true,
          filters: { label: [`com.docker.compose.project=${agentName}`] },
        });
        for (const c of composeContainers) {
          try {
            const ct = this.docker.getContainer(c.Id);
            try { await ct.stop(); } catch { /* may already be stopped */ }
            await ct.remove();
          } catch { /* best effort */ }
        }
      } catch { /* best effort */ }
    }
  }

  async getTransport(remoteId: string): Promise<Transport> {
    return new DockerTransport(this.docker.getContainer(remoteId));
  }

  async getContainerIp(remoteId: string): Promise<string | undefined> {
    try {
      const info = await this.docker.getContainer(remoteId).inspect();
      // Check named network first (for Docker Compose), fall back to default bridge
      if (NETWORK && info.NetworkSettings?.Networks?.[NETWORK]) {
        return info.NetworkSettings.Networks[NETWORK].IPAddress || undefined;
      }
      return (info.NetworkSettings as Record<string, any>)?.IPAddress || undefined;
    } catch { return undefined; }
  }

  async isRunning(remoteId: string): Promise<boolean> {
    try {
      const info = await this.docker.getContainer(remoteId).inspect();
      return info.State.Running === true;
    } catch { return false; }
  }

  /** List all containers managed by dindang (any state). */
  async listManaged(): Promise<{ id: string; name: string; running: boolean }[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: [LABEL] },
    });
    return containers.map((c) => ({
      id: c.Id,
      name: (c.Names[0] ?? "").replace(/^\//, ""),
      running: c.State === "running",
    }));
  }

}
