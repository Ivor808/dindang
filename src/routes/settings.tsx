import { createFileRoute, useRouter, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  loadSettings,
  saveKeys,
  createProject,
  editProject,
  deleteProject,
} from "~/server/settings";
import type { Project } from "~/lib/types";

export const Route = createFileRoute("/settings")({
  loader: () => loadSettings(),
  component: SettingsPage,
});

function SettingsPage() {
  const settings = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  const [anthropicKey, setAnthropicKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);

  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [setupCmd, setSetupCmd] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  const handleSaveKeys = async () => {
    if (!anthropicKey && !githubToken) return;
    setSaving(true);
    setKeyMsg(null);
    try {
      await saveKeys({
        data: {
          anthropicApiKey: anthropicKey,
          githubToken: githubToken,
        },
      });
      setAnthropicKey("");
      setGithubToken("");
      setKeyMsg("Saved");
      await router.invalidate();
    } catch (e) {
      setKeyMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleAddProject = async () => {
    if (!projectName.trim() || !repoUrl.trim()) return;
    setProjectError(null);
    try {
      await createProject({
        data: {
          name: projectName.trim(),
          repoUrl: repoUrl.trim(),
          setupCommand: setupCmd.trim() || undefined,
          isDefault,
        },
      });
      setProjectName("");
      setRepoUrl("");
      setSetupCmd("");
      setIsDefault(false);
      setShowProjectForm(false);
      await router.invalidate();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteProject({ data: id });
      await router.invalidate();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await editProject({ data: { id, isDefault: true } });
      await router.invalidate();
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => navigate({ to: "/" })}
          className="text-zinc-500 hover:text-zinc-300 text-sm cursor-pointer"
        >
          &larr; back
        </button>
        <h1 className="text-xl font-bold">settings</h1>
      </div>

      <section className="mb-10">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-4">
          Credentials
        </h2>
        <div className="space-y-4 bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">
              Anthropic API Key
              {settings.hasAnthropicKey && (
                <span className="text-green-500 ml-2">configured ({settings.anthropicApiKey})</span>
              )}
            </label>
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder={settings.hasAnthropicKey ? "Enter new key to replace" : "sk-ant-..."}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">
              GitHub Token
              {settings.hasGithubToken && (
                <span className="text-green-500 ml-2">configured ({settings.githubToken})</span>
              )}
            </label>
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder={settings.hasGithubToken ? "Enter new token to replace" : "ghp_..."}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveKeys}
              disabled={saving || (!anthropicKey && !githubToken)}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
            >
              {saving ? "saving..." : "save keys"}
            </button>
            {keyMsg && (
              <span className={`text-xs ${keyMsg === "Saved" ? "text-green-400" : "text-red-400"}`}>
                {keyMsg}
              </span>
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide">
            Projects
          </h2>
          <button
            onClick={() => setShowProjectForm(!showProjectForm)}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors cursor-pointer"
          >
            {showProjectForm ? "cancel" : "+ add project"}
          </button>
        </div>

        {projectError && (
          <p className="text-red-400 text-xs mb-3">Error: {projectError}</p>
        )}

        {showProjectForm && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4 space-y-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="backend-api"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Repo URL</label>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="github.com/org/repo"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Setup Command (optional)</label>
              <input
                type="text"
                value={setupCmd}
                onChange={(e) => setSetupCmd(e.target.value)}
                placeholder="npm install && npm run build"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isDefault"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="accent-zinc-500"
              />
              <label htmlFor="isDefault" className="text-xs text-zinc-400">
                Set as default project
              </label>
            </div>
            <button
              onClick={handleAddProject}
              disabled={!projectName.trim() || !repoUrl.trim()}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
            >
              add project
            </button>
          </div>
        )}

        {settings.projects.length === 0 ? (
          <p className="text-zinc-600 text-sm">No projects configured yet.</p>
        ) : (
          <div className="space-y-2">
            {settings.projects.map((project: Project) => (
              <div
                key={project.id}
                className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{project.name}</span>
                    {project.isDefault && (
                      <span className="text-xs bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded">
                        default
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">{project.repoUrl}</p>
                  {project.setupCommand && (
                    <p className="text-xs text-zinc-600 mt-0.5 font-mono">
                      $ {project.setupCommand}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {!project.isDefault && (
                    <button
                      onClick={() => handleSetDefault(project.id)}
                      className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    >
                      set default
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteProject(project.id)}
                    className="text-xs text-red-400 hover:text-red-300 cursor-pointer"
                  >
                    remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
