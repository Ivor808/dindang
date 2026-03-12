import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { encrypt, decrypt } from "./crypto";
import type { Settings, Project } from "./types";

const CONFIG_DIR = join(homedir(), ".dindang");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface ConfigFile {
  anthropicApiKey?: string;
  githubToken?: string;
  projects: Project[];
}

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readConfig(): ConfigFile {
  ensureDir();
  if (!existsSync(CONFIG_FILE)) {
    return { projects: [] };
  }
  const raw = readFileSync(CONFIG_FILE, "utf8");
  return JSON.parse(raw) as ConfigFile;
}

function writeConfig(config: ConfigFile): void {
  ensureDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

export function getSettings(): Settings {
  const config = readConfig();
  return {
    anthropicApiKey: config.anthropicApiKey ? decrypt(config.anthropicApiKey) : "",
    githubToken: config.githubToken ? decrypt(config.githubToken) : "",
    projects: config.projects,
  };
}

export function saveCredentials(anthropicApiKey: string, githubToken: string): void {
  const config = readConfig();
  if (anthropicApiKey) config.anthropicApiKey = encrypt(anthropicApiKey);
  if (githubToken) config.githubToken = encrypt(githubToken);
  writeConfig(config);
}

export function getProjects(): Project[] {
  return readConfig().projects;
}

export function addProject(project: Omit<Project, "id">): Project {
  const config = readConfig();
  const newProject: Project = { ...project, id: randomBytes(8).toString("hex") };
  if (newProject.isDefault) {
    config.projects.forEach((p) => (p.isDefault = false));
  }
  if (config.projects.length === 0) {
    newProject.isDefault = true;
  }
  config.projects.push(newProject);
  writeConfig(config);
  return newProject;
}

export function updateProject(id: string, updates: Partial<Omit<Project, "id">>): Project {
  const config = readConfig();
  const idx = config.projects.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Project ${id} not found`);
  if (updates.isDefault) {
    config.projects.forEach((p) => (p.isDefault = false));
  }
  config.projects[idx] = { ...config.projects[idx]!, ...updates };
  writeConfig(config);
  return config.projects[idx]!;
}

export function removeProject(id: string): void {
  const config = readConfig();
  const idx = config.projects.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Project ${id} not found`);
  const wasDefault = config.projects[idx]!.isDefault;
  config.projects.splice(idx, 1);
  if (wasDefault && config.projects.length > 0) {
    config.projects[0]!.isDefault = true;
  }
  writeConfig(config);
}
