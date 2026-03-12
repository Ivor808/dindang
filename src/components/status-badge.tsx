import type { AgentStatus } from "~/lib/types";

const styles: Record<AgentStatus, string> = {
  provisioning: "bg-yellow-900 text-yellow-300",
  ready: "bg-green-900 text-green-300",
  busy: "bg-blue-900 text-blue-300",
  error: "bg-red-900 text-red-300",
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </span>
  );
}
