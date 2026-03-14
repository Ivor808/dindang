import type { Transport } from "~/lib/transport";

export interface AgentSetupOptions {
  name: string;
  repoUrl: string;
  workDir: string;
  githubToken?: string;
  setupCommand?: string;
  callbackUrl: string;
  onProgress?: (message: string) => void;
}

export function repoNameFromUrl(url: string): string {
  const parts = url.replace(/\.git$/, "").split("/");
  return parts[parts.length - 1] || "workspace";
}

export function validateRepoUrl(url: string): string {
  const normalized = url.startsWith("http") ? url : `https://${url}`;
  let parsed: URL;
  try { parsed = new URL(normalized); } catch { throw new Error("Invalid repository URL"); }
  if (parsed.protocol !== "https:") throw new Error("Repository URL must use HTTPS");
  const allowedHosts = ["github.com", "gitlab.com", "bitbucket.org"];
  if (!allowedHosts.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
    throw new Error(`Repository host not allowed: ${parsed.hostname}`);
  }
  return normalized;
}

export async function setupAgent(transport: Transport, options: AgentSetupOptions): Promise<void> {
  const { onProgress = () => {} } = options;

  const hasGit = await transport.exec(["which", "git"]);
  if (hasGit.exitCode !== 0) {
    onProgress("Installing system dependencies...");
    await transport.exec(["bash", "-c", "apt-get update -qq && apt-get install -y -qq git curl build-essential"]);
  }

  const hasClaude = await transport.exec(["which", "claude"]);
  if (hasClaude.exitCode !== 0) {
    onProgress("Installing Claude Code...");
    await transport.exec(["bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"]);
    await transport.exec(["bash", "-c", "ln -sf $(which claude 2>/dev/null || echo $HOME/.local/bin/claude) /usr/local/bin/claude"]);
  }

  if (options.githubToken) {
    await transport.exec([
      "git", "config", "--global", "credential.helper",
      "!f() { test \"$1\" = get && echo protocol=https && echo host=github.com && echo username=x-access-token && echo password=$GITHUB_TOKEN; }; f",
    ]);
  }

  const repoExists = await transport.fileExists(options.workDir);
  if (!repoExists) {
    onProgress(`Cloning ${options.repoUrl}...`);
    await transport.exec(["git", "clone", options.repoUrl, options.workDir]);
  }

  const hooksConfig = JSON.stringify({
    hooks: {
      PostToolUse: [{ hooks: [{ type: "http", url: `${options.callbackUrl}/api/hooks/agent/${options.name}` }] }],
      Stop: [{ hooks: [{ type: "http", url: `${options.callbackUrl}/api/hooks/agent/${options.name}` }] }],
    },
  });
  await transport.writeFile(`${options.workDir}/.claude/settings.json`, hooksConfig);

  if (options.setupCommand) {
    onProgress(`Running setup: ${options.setupCommand}`);
    await transport.exec(["bash", "-c", options.setupCommand], { cwd: options.workDir });
  }

  onProgress("Ready.");
}
