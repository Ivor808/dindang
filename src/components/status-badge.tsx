import type { AgentStatus } from "~/lib/types";

const styles: Record<AgentStatus, string> = {
  idle: "bg-zinc-700 text-zinc-300",
  running: "bg-blue-900 text-blue-300",
  done: "bg-green-900 text-green-300",
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
