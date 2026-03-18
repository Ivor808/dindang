import { useState, useEffect } from "react";

const CURRENT_VERSION = import.meta.env.VITE_DINDANG_VERSION ?? "dev";
const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour
const GITHUB_API = "https://api.github.com/repos/Ivor808/dindang/commits/master";

export function UpdateBanner() {
  const [latestSha, setLatestSha] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (CURRENT_VERSION === "dev") return;

    const check = () => {
      fetch(GITHUB_API, { headers: { Accept: "application/vnd.github.v3+json" } })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.sha && !data.sha.startsWith(CURRENT_VERSION)) {
            setLatestSha(data.sha.slice(0, 7));
          }
        })
        .catch(() => {}); // Network errors are fine — skip silently
    };

    check();
    const interval = setInterval(check, CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  if (!latestSha || dismissed || CURRENT_VERSION === "dev") return null;

  return (
    <div className="bg-blue-950/50 border-b border-blue-900 px-6 py-2 flex items-center justify-between text-xs">
      <span className="text-blue-300">
        Update available ({CURRENT_VERSION} &rarr; {latestSha}).
        Run: <code className="bg-blue-900/50 px-1.5 py-0.5 rounded">curl -fsSL https://raw.githubusercontent.com/Ivor808/dindang/master/install.sh | sh</code>
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="text-blue-500 hover:text-blue-300 cursor-pointer ml-4"
      >
        dismiss
      </button>
    </div>
  );
}
