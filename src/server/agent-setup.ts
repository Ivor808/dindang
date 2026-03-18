import type { Transport } from "~/lib/transport";
import type { AiCli } from "~/lib/types";

export interface AgentSetupOptions {
  name: string;
  repoUrl?: string;
  workDir: string;
  githubToken?: string;
  setupCommand?: string;
  aiCli: AiCli;
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

/** Run a command as the dev user (runuser doesn't require a password) */
export function asUser(cmd: string): string[] {
  return ["runuser", "-l", "dev", "-c", cmd];
}

export async function setupAgent(transport: Transport, options: AgentSetupOptions): Promise<void> {
  const { onProgress = () => {} } = options;

  // --- Phase 1: Root setup (system packages, user creation) ---

  const hasGit = await transport.exec(["which", "git"]);
  if (hasGit.exitCode !== 0) {
    onProgress("Installing system dependencies...");
    await transport.exec(["bash", "-c", "apt-get update -qq && apt-get install -y -qq git curl build-essential sudo procps psmisc lsof tmux locales"]);
    // Generate UTF-8 locale for proper Unicode rendering (Claude Code UI uses emoji)
    await transport.exec(["bash", "-c", "sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen"]);
  }

  // Create non-root dev user with passwordless sudo
  const hasUser = await transport.exec(["id", "dev"]);
  if (hasUser.exitCode !== 0) {
    onProgress("Creating dev user...");
    await transport.exec(["bash", "-c", "useradd -m -s /bin/bash -d /home/dev dev"]);
    await transport.exec(["bash", "-c", "echo 'dev ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/dev"]);
    // Give dev user ownership of /home (the volume mount)
    await transport.exec(["chown", "-R", "dev:dev", "/home/dev"]);
  }

  // --- Phase 2: User-level setup (AI CLI, git, repo, setup command) ---

  // Install AI CLI as dev user
  if (options.aiCli === "claude") {
    const hasClaude = await transport.exec(asUser("which claude"));
    if (hasClaude.exitCode !== 0) {
      onProgress("Installing Claude Code...");
      const claudeInstall = await transport.exec(asUser("curl -fsSL https://claude.ai/install.sh | bash"));
      if (claudeInstall.exitCode !== 0) {
        console.error(`[agent-setup] Claude Code install failed for ${options.name} (exit ${claudeInstall.exitCode}): ${claudeInstall.stderr}`);
      }
    }
  } else if (options.aiCli === "codex") {
    const hasCodex = await transport.exec(asUser("which codex"));
    if (hasCodex.exitCode !== 0) {
      onProgress("Installing Codex CLI...");
      await transport.exec(["bash", "-c", "npm install -g @openai/codex"]);
    }
  }

  // Configure git credentials as dev user
  if (options.githubToken) {
    // Inline the token — runuser -l starts a login shell that doesn't inherit container env vars
    const escaped = options.githubToken.replace(/'/g, "'\\''");
    await transport.exec(asUser(
      `git config --global credential.helper '!f() { test "$1" = get && echo protocol=https && echo host=github.com && echo username=x-access-token && echo "password=${escaped}"; }; f'`,
    ));
  }

  // Clone repo as dev user
  if (options.repoUrl) {
    const repoExists = await transport.fileExists(options.workDir);
    if (!repoExists) {
      onProgress(`Cloning ${options.repoUrl}...`);
      const clone = await transport.exec(asUser(`git clone ${options.repoUrl} ${options.workDir}`));
      if (clone.exitCode !== 0) {
        throw new Error(`git clone failed (exit ${clone.exitCode}): ${clone.stderr}`);
      }
    }
  } else {
    // Ensure workDir exists for projects without a repo
    await transport.exec(asUser(`mkdir -p ${options.workDir}`));
  }

  // Write Claude hooks config as dev user
  if (options.aiCli === "claude") {
    const hooksConfig = JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ type: "http", url: `${options.callbackUrl}/api/hooks/agent/${options.name}/PreToolUse` }] }],
        PostToolUse: [{ hooks: [{ type: "http", url: `${options.callbackUrl}/api/hooks/agent/${options.name}/PostToolUse` }] }],
        Stop: [{ hooks: [{ type: "http", url: `${options.callbackUrl}/api/hooks/agent/${options.name}/Stop` }] }],
      },
    });
    await transport.exec(asUser(`mkdir -p ${options.workDir}/.claude`));
    await transport.writeFile(`${options.workDir}/.claude/settings.json`, hooksConfig);
    await transport.exec(["chown", "-R", "dev:dev", `${options.workDir}/.claude`]);
  }

  // Write minimal tmux config for the dev user
  const tmuxConf = [
    "set -g default-terminal 'xterm-256color'", // keep TERM consistent with xterm.js
    "set -g default-shell '/bin/bash'",          // ensure bash as default shell
    "set -g default-command 'bash -l'",          // login shell so .bashrc/.profile are sourced
    "set -g aggressive-resize on",   // resize window to current client, not smallest
    "set -g status off",             // hide status bar (dindang has its own UI chrome)
    "set -g history-limit 50000",    // generous scrollback
  ].join("\n") + "\n";
  await transport.writeFile("/home/dev/.tmux.conf", tmuxConf);
  await transport.exec(["chown", "dev:dev", "/home/dev/.tmux.conf"]);

  // Run setup command as dev user
  if (options.setupCommand) {
    onProgress(`Running setup: ${options.setupCommand}`);
    const setup = await transport.exec(asUser(`cd ${options.workDir} && ${options.setupCommand}`));
    if (setup.exitCode !== 0) {
      console.error(`[agent-setup] setup command failed for ${options.name} (exit ${setup.exitCode})`);
      console.error(`[agent-setup] stdout: ${setup.stdout}`);
      console.error(`[agent-setup] stderr: ${setup.stderr}`);
      throw new Error(`Setup command failed (exit ${setup.exitCode}): ${setup.stderr || setup.stdout || '(no output)'}`);
    }
  }

  onProgress("Ready.");
}
