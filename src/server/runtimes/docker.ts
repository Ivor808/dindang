import Docker from "dockerode";
import type { AgentRuntime, AgentRuntimeOptions, Transport } from "~/lib/transport";
import { DockerTransport } from "~/server/transports/docker";

const LABEL = "dindang.managed";
const IMAGE = "node:22-slim";

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

    const portBindings: Record<string, Array<{ HostPort: string }>> = {};
    const exposedPorts: Record<string, Record<string, never>> = {};
    if (options.devPort) {
      const key = `${options.devPort}/tcp`;
      exposedPorts[key] = {};
      portBindings[key] = [{ HostPort: "0" }];
    }

    const envArr = Object.entries(options.env).map(([k, v]) => `${k}=${v}`);

    const container = await this.docker.createContainer({
      Image: IMAGE,
      name: options.name,
      Labels: { [LABEL]: "true", "dindang.agent": options.name },
      ExposedPorts: exposedPorts,
      Tty: true,
      OpenStdin: true,
      Env: envArr,
      Cmd: ["bash", "-c", "trap 'exit 0' TERM; while true; do sleep 1; done"],
      HostConfig: { PortBindings: portBindings },
    });
    await container.start();

    const info = await container.inspect();
    const hostPort = this.getHostPort(info);
    return { remoteId: info.Id, hostPort };
  }

  async stop(remoteId: string): Promise<void> {
    await this.docker.getContainer(remoteId).stop();
  }

  async remove(remoteId: string): Promise<void> {
    const container = this.docker.getContainer(remoteId);
    try { await container.stop(); } catch { /* may already be stopped */ }
    await container.remove();
  }

  async getTransport(remoteId: string): Promise<Transport> {
    return new DockerTransport(this.docker.getContainer(remoteId));
  }

  async isRunning(remoteId: string): Promise<boolean> {
    try {
      const info = await this.docker.getContainer(remoteId).inspect();
      return info.State.Running === true;
    } catch { return false; }
  }

  private getHostPort(info: Docker.ContainerInspectInfo): number | undefined {
    const ports = info.NetworkSettings?.Ports;
    if (!ports) return undefined;
    for (const bindings of Object.values(ports)) {
      if (bindings && bindings.length > 0 && bindings[0]?.HostPort) {
        return parseInt(bindings[0].HostPort, 10);
      }
    }
    return undefined;
  }
}
