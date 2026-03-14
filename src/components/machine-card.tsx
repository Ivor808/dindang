import type { Machine } from "~/lib/types";

export function MachineCard({
  machine,
  onEdit,
  onDelete,
  onToggle,
}: {
  machine: Machine;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium truncate">{machine.name}</span>
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            machine.status === "connected"
              ? "bg-green-900 text-green-300"
              : machine.status === "unreachable"
                ? "bg-red-900 text-red-300"
                : "bg-zinc-700 text-zinc-400"
          }`}
        >
          {machine.status}
        </span>
      </div>
      <p className="text-xs text-zinc-500">
        {machine.type === "ssh"
          ? `${machine.username}@${machine.host}:${machine.port}`
          : "Local Docker"}
      </p>
      <div className="flex gap-2 mt-3">
        <button
          onClick={onToggle}
          className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
        >
          {machine.enabled ? "disable" : "enable"}
        </button>
        <button
          onClick={onEdit}
          className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
        >
          edit
        </button>
        <button
          onClick={onDelete}
          className="text-xs text-red-500 hover:text-red-300 cursor-pointer"
        >
          remove
        </button>
      </div>
    </div>
  );
}
