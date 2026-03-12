import { createServerFn } from "@tanstack/react-start";
import { dockerProvider } from "~/lib/docker-provider";
import { randomName } from "~/lib/names";

export const listAgents = createServerFn({ method: "GET" }).handler(
  async () => {
    return dockerProvider.list();
  }
);

export const getAgent = createServerFn({ method: "GET" })
  .inputValidator((name: string) => name)
  .handler(async ({ data: name }) => {
    return dockerProvider.getStatus(name);
  });

export const createAgent = createServerFn({ method: "POST" }).handler(
  async () => {
    const name = randomName();
    return dockerProvider.create(name);
  }
);

export const startAgent = createServerFn({ method: "POST" })
  .inputValidator((data: { name: string; command: string }) => data)
  .handler(async ({ data }) => {
    await dockerProvider.start(data.name, data.command);
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
    const parts: string[] = [];
    for await (const chunk of dockerProvider.getLogs(name)) {
      parts.push(chunk);
    }
    return parts.join("");
  });
