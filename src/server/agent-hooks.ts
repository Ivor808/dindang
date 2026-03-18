import type { IncomingMessage, ServerResponse } from "http";
import { eq, and, ne } from "drizzle-orm";
import { db } from "~/db";
import { agents } from "~/db/schema";

const HOOK_PATH_RE = /^\/api\/hooks\/agent\/([^/]+?)(?:\/(PreToolUse|PostToolUse|Stop))?$/;

export function agentHooksMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  if (req.method !== "POST") { next(); return; }

  const match = req.url?.match(HOOK_PATH_RE);
  if (!match) { next(); return; }

  const agentName = match[1]!;
  const event = match[2] as string | undefined;

  console.log(`[hooks] ${req.method} ${req.url} — agent=${agentName} event=${event}`);

  // Respond immediately — don't block Claude Code waiting for our DB write
  req.on("data", () => {}); // drain request body
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
    handleHook(agentName, event).catch((e) => console.error("[hooks] error:", e));
  });
}

async function handleHook(agentName: string, event: string | undefined): Promise<void> {
  if (event === "PreToolUse" || event === "PostToolUse") {
    // Only update if not already busy (avoids DB thrashing on every tool use)
    await db
      .update(agents)
      .set({ status: "busy", busySince: new Date() })
      .where(and(eq(agents.name, agentName), ne(agents.status, "busy")));
  } else if (event === "Stop") {
    await db
      .update(agents)
      .set({ status: "ready", busySince: null })
      .where(eq(agents.name, agentName));
  }
}
