import Docker from "dockerode";
import type { DeploymentProvider, CreateAgentOptions } from "~/lib/provider";
import type { Agent, AgentStatus } from "~/lib/types";

const LABEL = "dindang.managed";
const IMAGE = "node:22-slim";

const docker = new Docker();

const execOutputs = new Map<string, string>();
const agentMeta = new Map<string, { projectId: string; machineId: string }>();

function mapStatus(state: { Running?: boolean; Status?: string; ExitCode?: number }): AgentStatus {
  if (state.Running) return "ready";
  if (state.Status === "created") return "provisioning";
  if (state.Status === "exited" && state.ExitCode === 0) return "ready";
  if (state.Status === "exited") return "error";
  return "provisioning";
}

function inspectToAgent(info: Docker.ContainerInspectInfo): Agent {
  const name = info.Name.replace(/^\//, "");
  const meta = agentMeta.get(name);
  const labels = info.Config.Labels || {};

  return {
    id: info.Id,
    name,
    projectId: meta?.projectId || labels["dindang.project"] || "",
    machineId: meta?.machineId || "localhost",
    containerId: info.Id,
    status: mapStatus(info.State),
    createdAt: info.Created,
  };
}

function containerToAgent(c: Docker.ContainerInfo): Agent {
  const name = c.Names[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12);
  const meta = agentMeta.get(name);
  const labels = c.Labels || {};

  let status: AgentStatus;
  if (c.State === "running") status = "ready";
  else if (c.State === "created") status = "provisioning";
  else if (c.State === "exited" && c.Status?.includes("Exited (0)")) status = "ready";
  else if (c.State === "exited") status = "error";
  else status = "provisioning";

  return {
    id: c.Id,
    name,
    projectId: meta?.projectId || labels["dindang.project"] || "",
    machineId: meta?.machineId || "localhost",
    containerId: c.Id,
    status,
    createdAt: new Date(c.Created * 1000).toISOString(),
  };
}

export const dockerProvider: DeploymentProvider = {
  async create(options) {
    try {
      await docker.getImage(IMAGE).inspect();
    } catch {
      const stream = await docker.pull(IMAGE);
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (err: Error | null) =>
          err ? reject(err) : resolve()
        );
      });
    }

    const container = await docker.createContainer({
      Image: IMAGE,
      name: options.name,
      Labels: {
        [LABEL]: "true",
        "dindang.project": options.projectId,
      },
      Tty: true,
      OpenStdin: true,
      Env: [
        `ANTHROPIC_API_KEY=${options.anthropicApiKey}`,
        `GITHUB_TOKEN=${options.githubToken}`,
      ],
      Cmd: ["bash", "-c", "trap 'exit 0' TERM; while true; do sleep 1; done"],
    });
    await container.start();

    agentMeta.set(options.name, { projectId: options.projectId, machineId: "localhost" });

    const setupSteps: string[] = [
      "apt-get update -qq && apt-get install -y -qq git curl build-essential > /dev/null 2>&1",
    ];

    const repoUrl = options.repoUrl.startsWith("http")
      ? options.repoUrl
      : `https://${options.repoUrl}`;
    const authedUrl = options.githubToken
      ? repoUrl.replace("https://", `https://${options.githubToken}@`)
      : repoUrl;
    setupSteps.push(`git clone ${authedUrl} /workspace > /dev/null 2>&1`);

    setupSteps.push("curl -fsSL https://claude.ai/install.sh | bash > /dev/null 2>&1");

    const hooksConfig = JSON.stringify({
      hooks: {
        PostToolUse: [{
          hooks: [{
            type: "http",
            url: `http://${options.dindangHost}/api/hooks/agent/${options.name}`,
          }],
        }],
        Stop: [{
          hooks: [{
            type: "http",
            url: `http://${options.dindangHost}/api/hooks/agent/${options.name}`,
          }],
        }],
      },
    });
    const escapedHooksConfig = hooksConfig.replace(/'/g, "'\\''");
    setupSteps.push(`mkdir -p /workspace/.claude && echo '${escapedHooksConfig}' > /workspace/.claude/settings.json`);

    if (options.setupCommand) {
      setupSteps.push(`cd /workspace && ${options.setupCommand}`);
    }

    const fullSetup = setupSteps.join(" && ");
    const exec = await container.exec({
      Cmd: ["bash", "-c", fullSetup],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    stream.on("data", (chunk: Buffer) => {
      execOutputs.set(
        options.name,
        (execOutputs.get(options.name) ?? "") + chunk.toString()
      );
    });

    const info = await container.inspect();
    return inspectToAgent(info);
  },

  async exec(nameOrId, command) {
    const container = docker.getContainer(nameOrId);
    const exec = await container.exec({
      Cmd: ["bash", "-c", `cd /workspace && ${command}`],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ hijack: true, stdin: false });
    stream.on("data", (chunk: Buffer) => {
      execOutputs.set(
        nameOrId,
        (execOutputs.get(nameOrId) ?? "") + chunk.toString()
      );
    });
  },

  async stop(nameOrId) {
    const container = docker.getContainer(nameOrId);
    await container.stop();
  },

  async remove(nameOrId) {
    const container = docker.getContainer(nameOrId);
    try {
      await container.stop();
    } catch {
      // may already be stopped
    }
    await container.remove();
    execOutputs.delete(nameOrId);
    agentMeta.delete(nameOrId);
  },

  async getStatus(nameOrId) {
    const container = docker.getContainer(nameOrId);
    const info = await container.inspect();
    return inspectToAgent(info);
  },

  async getLogs(nameOrId) {
    return execOutputs.get(nameOrId) ?? "";
  },

  async list() {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: [LABEL] },
    });
    return containers.map(containerToAgent);
  },
};
