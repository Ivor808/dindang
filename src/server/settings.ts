import { createServerFn } from "@tanstack/react-start";
import {
  getSettings,
  saveCredentials,
  getProjects,
  addProject,
  updateProject,
  removeProject,
} from "~/lib/config";
import type { Project } from "~/lib/types";

export const loadSettings = createServerFn({ method: "GET" }).handler(async () => {
  const settings = getSettings();
  return {
    anthropicApiKey: settings.anthropicApiKey
      ? `${"•".repeat(Math.max(0, settings.anthropicApiKey.length - 4))}${settings.anthropicApiKey.slice(-4)}`
      : "",
    githubToken: settings.githubToken
      ? `${"•".repeat(Math.max(0, settings.githubToken.length - 4))}${settings.githubToken.slice(-4)}`
      : "",
    hasAnthropicKey: settings.anthropicApiKey.length > 0,
    hasGithubToken: settings.githubToken.length > 0,
    projects: settings.projects,
  };
});

export const saveKeys = createServerFn({ method: "POST" })
  .inputValidator((data: { anthropicApiKey: string; githubToken: string }) => data)
  .handler(async ({ data }) => {
    saveCredentials(data.anthropicApiKey, data.githubToken);
    return { ok: true };
  });

export const listProjects = createServerFn({ method: "GET" }).handler(async () => {
  return getProjects();
});

export const createProject = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { name: string; repoUrl: string; setupCommand?: string; isDefault: boolean }) => data
  )
  .handler(async ({ data }) => {
    return addProject(data);
  });

export const editProject = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { id: string; name?: string; repoUrl?: string; setupCommand?: string; isDefault?: boolean }) => data
  )
  .handler(async ({ data }) => {
    const { id, ...updates } = data;
    return updateProject(id, updates);
  });

export const deleteProject = createServerFn({ method: "POST" })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    removeProject(id);
    return { ok: true };
  });
