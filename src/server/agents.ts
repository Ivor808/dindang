import { createServerFn } from "@tanstack/react-start";
import { dockerProvider } from "./docker-provider";
import { getSettings } from "~/lib/config";
import { randomName } from "~/lib/names";

export const listAgents = createServerFn({ method: "GET" }).handler(async () => {
  return dockerProvider.list();
});

export const getAgent = createServerFn({ method: "GET" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }) => {
    return dockerProvider.getStatus(name);
  });

export const createAgent = createServerFn({ method: "POST" })
  .inputValidator((data: { projectId: string }) => data)
  .handler(async ({ data }) => {
    const settings = getSettings();
    const project = settings.projects.find((p) => p.id === data.projectId);
    if (!project) throw new Error("Project not found");
    if (!settings.anthropicApiKey) throw new Error("Anthropic API key not configured — go to Settings");

    const name = randomName();
    return dockerProvider.create({
      name,
      projectId: project.id,
      repoUrl: project.repoUrl,
      githubToken: settings.githubToken,
      anthropicApiKey: settings.anthropicApiKey,
      setupCommand: project.setupCommand,
      dindangHost: "host.docker.internal:3000",
    });
  });

export const execAgent = createServerFn({ method: "POST" })
  .inputValidator((data: { name: string; command: string }) => data)
  .handler(async ({ data }) => {
    await dockerProvider.exec(data.name, data.command);
    return dockerProvider.getStatus(data.name);
  });

export const stopAgent = createServerFn({ method: "POST" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }) => {
    await dockerProvider.stop(name);
    return dockerProvider.getStatus(name);
  });

export const removeAgent = createServerFn({ method: "POST" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }) => {
    await dockerProvider.remove(name);
    return { ok: true };
  });

export const getAgentLogs = createServerFn({ method: "GET" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }) => {
    return dockerProvider.getLogs(name);
  });
