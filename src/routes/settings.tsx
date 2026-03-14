import { createFileRoute, useRouter, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  loadSettings,
  listMachinesApi,
  createMachineApi,
  editMachineApi,
  deleteMachineApi,
  createProject,
  editProject,
  deleteProject,
  saveCredential,
  getCredentialStatus,
  listMembers,
  inviteMember,
  removeMember,
  changeRole,
} from "~/server/settings";
import { MachineCard } from "~/components/machine-card";
import { toErrorMessage } from "~/lib/errors";
import type { Project, Machine } from "~/lib/types";

type Tab = "projects" | "machines" | "credentials" | "team";

export const Route = createFileRoute("/settings")({
  loader: async () => {
    const [settings, machines, credStatus, members] = await Promise.all([
      loadSettings(),
      listMachinesApi(),
      getCredentialStatus(),
      listMembers(),
    ]);
    return { settings, machines, credStatus, members };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { settings, machines, credStatus, members } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("projects");

  const tabs: { key: Tab; label: string }[] = [
    { key: "projects", label: "Projects" },
    { key: "machines", label: "Machines" },
    { key: "credentials", label: "Credentials" },
    { key: "team", label: "Team" },
  ];

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate({ to: "/" })}
          className="text-zinc-500 hover:text-zinc-300 text-sm cursor-pointer"
        >
          &larr; back
        </button>
        <h1 className="text-xl font-bold">settings</h1>
      </div>

      <div className="flex gap-1 mb-6 border-b border-zinc-800">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-xs transition-colors cursor-pointer ${
              activeTab === tab.key
                ? "text-zinc-100 border-b-2 border-zinc-400"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "projects" && (
        <ProjectsTab projects={settings.projects} router={router} />
      )}
      {activeTab === "machines" && (
        <MachinesTab machines={machines} router={router} />
      )}
      {activeTab === "credentials" && (
        <CredentialsTab credStatus={credStatus} router={router} />
      )}
      {activeTab === "team" && (
        <TeamTab members={members} router={router} />
      )}
    </div>
  );
}

// ── Projects Tab ────────────────────────────────────────────────────────────

function ProjectsTab({
  projects,
  router,
}: {
  projects: Project[];
  router: ReturnType<typeof useRouter>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [setupCmd, setSetupCmd] = useState("");
  const [devPort, setDevPort] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setProjectName("");
    setRepoUrl("");
    setSetupCmd("");
    setDevPort("");
    setIsDefault(false);
    setEditingId(null);
  };

  const startEdit = (p: Project) => {
    setEditingId(p.id);
    setProjectName(p.name);
    setRepoUrl(p.repoUrl ?? "");
    setSetupCmd(p.setupCommand ?? "");
    setDevPort(p.devPort ? String(p.devPort) : "");
    setIsDefault(p.isDefault);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!projectName.trim() || !repoUrl.trim()) return;
    setError(null);
    try {
      if (editingId) {
        await editProject({
          data: {
            id: editingId,
            name: projectName.trim(),
            repoUrl: repoUrl.trim(),
            setupCommand: setupCmd.trim() || undefined,
            devPort: devPort ? parseInt(devPort, 10) : undefined,
            isDefault,
          },
        });
      } else {
        await createProject({
          data: {
            name: projectName.trim(),
            repoUrl: repoUrl.trim(),
            setupCommand: setupCmd.trim() || undefined,
            devPort: devPort ? parseInt(devPort, 10) : undefined,
            isDefault,
          },
        });
      }
      resetForm();
      setShowForm(false);
      await router.invalidate();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProject({ data: id });
      await router.invalidate();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await editProject({ data: { id, isDefault: true } });
      await router.invalidate();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide">
          Projects
        </h2>
        <button
          onClick={() => { setShowForm(!showForm); if (showForm) resetForm(); }}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors cursor-pointer"
        >
          {showForm ? "cancel" : "+ add project"}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-xs mb-3">Error: {error}</p>
      )}

      {showForm && (
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
            <label className="block text-xs text-zinc-500 mb-1">
              Setup Command (optional)
            </label>
            <input
              type="text"
              value={setupCmd}
              onChange={(e) => setSetupCmd(e.target.value)}
              placeholder="npm install && npm run build"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">
              Dev Server Port (optional)
            </label>
            <input
              type="number"
              value={devPort}
              onChange={(e) => setDevPort(e.target.value)}
              placeholder="3000"
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
            onClick={handleSubmit}
            disabled={!projectName.trim() || !repoUrl.trim()}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
          >
            {editingId ? "save changes" : "add project"}
          </button>
        </div>
      )}

      {projects.length === 0 ? (
        <p className="text-zinc-600 text-sm">No projects configured yet.</p>
      ) : (
        <div className="space-y-2">
          {projects.map((project: Project) => (
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
                {project.devPort && (
                  <p className="text-xs text-zinc-600 mt-0.5">
                    port {project.devPort}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => startEdit(project)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
                >
                  edit
                </button>
                {!project.isDefault && (
                  <button
                    onClick={() => handleSetDefault(project.id)}
                    className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
                  >
                    set default
                  </button>
                )}
                <button
                  onClick={() => handleDelete(project.id)}
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
  );
}

// ── Machines Tab ────────────────────────────────────────────────────────────

function MachinesTab({
  machines,
  router,
}: {
  machines: Machine[];
  router: ReturnType<typeof useRouter>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"server" | "terminal">("server");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authMethod, setAuthMethod] = useState<"key" | "password">("key");
  const [credential, setCredential] = useState("");
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setType("server");
    setHost("");
    setPort("22");
    setUsername("");
    setAuthMethod("key");
    setCredential("");
  };

  const handleAdd = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      await createMachineApi({
        data: {
          name: name.trim(),
          type,
          ...(type === "server" || type === "terminal"
            ? {
                host: host.trim(),
                port: parseInt(port, 10) || 22,
                username: username.trim(),
                authMethod,
                credential: credential.trim() || undefined,
              }
            : {}),
        },
      });
      resetForm();
      setShowForm(false);
      await router.invalidate();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMachineApi({ data: id });
      await router.invalidate();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const handleToggle = async (machine: Machine) => {
    try {
      await editMachineApi({ data: { id: machine.id, enabled: !machine.enabled } });
      await router.invalidate();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide">
          Machines
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors cursor-pointer"
        >
          {showForm ? "cancel" : "+ add machine"}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-xs mb-3">Error: {error}</p>
      )}

      {showForm && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4 space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-server"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "server" | "terminal")}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500 cursor-pointer"
            >
              <option value="server">Server (managed Docker)</option>
              <option value="terminal">Terminal (direct SSH)</option>
            </select>
          </div>
          {(type === "server" || type === "terminal") && (
            <>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Host</label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="192.168.1.100"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Port</label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="22"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ubuntu"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Auth Method</label>
                <select
                  value={authMethod}
                  onChange={(e) => setAuthMethod(e.target.value as "key" | "password")}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500 cursor-pointer"
                >
                  <option value="key">SSH Key</option>
                  <option value="password">Password</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">
                  {authMethod === "key" ? "Private Key" : "Password"}
                </label>
                {authMethod === "key" ? (
                  <textarea
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    rows={4}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500 font-mono resize-none"
                  />
                ) : (
                  <input
                    type="password"
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
                  />
                )}
              </div>
            </>
          )}
          <button
            onClick={handleAdd}
            disabled={!name.trim()}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
          >
            add machine
          </button>
        </div>
      )}

      {machines.length === 0 ? (
        <p className="text-zinc-600 text-sm">No machines configured yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {machines.map((machine: Machine) => (
            <MachineCard
              key={machine.id}
              machine={machine}
              onEdit={() => {
                /* TODO: edit modal */
              }}
              onDelete={() => handleDelete(machine.id)}
              onToggle={() => handleToggle(machine)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Credentials Tab ─────────────────────────────────────────────────────────

function CredentialsTab({
  credStatus,
  router,
}: {
  credStatus: { hasGithub: boolean; hasAnthropic: boolean };
  router: ReturnType<typeof useRouter>;
}) {
  const [githubToken, setGithubToken] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (provider: "github" | "anthropic", token: string) => {
    if (!token.trim()) return;
    setSaving(provider);
    setSaved(null);
    setError(null);
    try {
      await saveCredential({ data: { provider, token: token.trim() } });
      if (provider === "github") setGithubToken("");
      else setAnthropicKey("");
      setSaved(provider);
      await router.invalidate();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-4">
        Credentials
      </h2>
      <div className="space-y-4">
        {error && (
          <p className="text-red-400 text-xs">Error: {error}</p>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <label className="block text-xs text-zinc-500 mb-1">
            GitHub Token
            {credStatus.hasGithub && (
              <span className="text-green-500 ml-2">configured</span>
            )}
          </label>
          <p className="text-xs text-zinc-600 mb-2">
            Auto-populated if you signed in with GitHub
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder={credStatus.hasGithub ? "Enter new token to replace" : "ghp_..."}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
            />
            <button
              onClick={() => handleSave("github", githubToken)}
              disabled={!githubToken.trim() || saving === "github"}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
            >
              {saving === "github" ? "saving..." : "save"}
            </button>
          </div>
          {saved === "github" && (
            <span className="text-xs text-green-400 mt-1 inline-block">Saved</span>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <label className="block text-xs text-zinc-500 mb-1">
            Anthropic API Key
            {credStatus.hasAnthropic && (
              <span className="text-green-500 ml-2">configured</span>
            )}
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder={credStatus.hasAnthropic ? "Enter new key to replace" : "sk-ant-..."}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
            />
            <button
              onClick={() => handleSave("anthropic", anthropicKey)}
              disabled={!anthropicKey.trim() || saving === "anthropic"}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
            >
              {saving === "anthropic" ? "saving..." : "save"}
            </button>
          </div>
          {saved === "anthropic" && (
            <span className="text-xs text-green-400 mt-1 inline-block">Saved</span>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Team Tab ────────────────────────────────────────────────────────────────

interface Member {
  id: string;
  userId: string;
  role: string;
  createdAt: Date | null;
}

function TeamTab({
  members,
  router,
}: {
  members: Member[];
  router: ReturnType<typeof useRouter>;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [error, setError] = useState<string | null>(null);

  const handleInvite = async () => {
    if (!userId.trim()) return;
    setError(null);
    try {
      await inviteMember({ data: { userId: userId.trim(), role } });
      setUserId("");
      setRole("member");
      await router.invalidate();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const handleRemove = async (memberId: string) => {
    try {
      await removeMember({ data: memberId });
      await router.invalidate();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const handleChangeRole = async (memberId: string, newRole: "admin" | "member") => {
    try {
      await changeRole({ data: { id: memberId, role: newRole } });
      await router.invalidate();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-4">
        Team
      </h2>

      {error && (
        <p className="text-red-400 text-xs mb-3">Error: {error}</p>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-4 space-y-3">
        <h3 className="text-xs text-zinc-400 font-semibold">Invite Member</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="User ID"
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "member")}
            className="bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-zinc-500 cursor-pointer"
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <button
            onClick={handleInvite}
            disabled={!userId.trim()}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-xs transition-colors cursor-pointer"
          >
            invite
          </button>
        </div>
      </div>

      {members.length === 0 ? (
        <p className="text-zinc-600 text-sm">No team members yet.</p>
      ) : (
        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm truncate">{member.userId}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    member.role === "owner"
                      ? "bg-amber-900 text-amber-300"
                      : member.role === "admin"
                        ? "bg-blue-900 text-blue-300"
                        : "bg-zinc-700 text-zinc-400"
                  }`}
                >
                  {member.role}
                </span>
              </div>
              {member.role !== "owner" && (
                <div className="flex items-center gap-2">
                  <select
                    value={member.role}
                    onChange={(e) =>
                      handleChangeRole(member.id, e.target.value as "admin" | "member")
                    }
                    className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-zinc-500 cursor-pointer"
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                  <button
                    onClick={() => handleRemove(member.id)}
                    className="text-xs text-red-400 hover:text-red-300 cursor-pointer"
                  >
                    remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
