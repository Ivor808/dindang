import { useEffect, useRef } from "react";

export function LogViewer({ lines }: { lines: string[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  return (
    <div className="bg-black rounded-lg p-4 h-96 overflow-y-auto text-sm text-zinc-300 font-mono">
      {lines.length === 0 ? (
        <span className="text-zinc-600">No output yet.</span>
      ) : (
        lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
