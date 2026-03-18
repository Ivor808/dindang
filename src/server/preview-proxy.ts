import type { IncomingMessage, ServerResponse } from "http";
import { request as httpRequest } from "http";
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { agents, projects, machines } from "~/db/schema";
import { DockerAgentRuntime } from "~/server/runtimes/docker";

const PREVIEW_PATH_RE = /^\/preview\/([^/]+)(\/.*)?$/;

export function previewProxyMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const match = req.url?.match(PREVIEW_PATH_RE);
  if (!match) {
    next();
    return;
  }

  const agentName = match[1]!;
  const subPath = match[2] || "/";

  handleProxy(agentName, subPath, req, res).catch(() => {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal proxy error");
    }
  });
}

async function handleProxy(agentName: string, subPath: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const agentRows = await db
    .select()
    .from(agents)
    .where(eq(agents.name, agentName))
    .limit(1);
  if (agentRows.length === 0) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`Agent not found: ${agentName}`);
    return;
  }
  const agent = agentRows[0]!;

  if (!agent.remoteId || !agent.machineId || !agent.projectId) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Agent is not fully configured");
    return;
  }

  const projectRows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, agent.projectId))
    .limit(1);
  const project = projectRows[0];
  if (!project?.devPort) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("No dev port configured for this project. Set it in Settings > Projects.");
    return;
  }

  const machineRows = await db
    .select()
    .from(machines)
    .where(eq(machines.id, agent.machineId))
    .limit(1);
  const machine = machineRows[0];
  if (!machine) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Machine not found");
    return;
  }

  let hostname: string;
  let port: number;

  if (machine.type === "local") {
    // Local Docker: connect to container IP directly
    const runtime = new DockerAgentRuntime();
    const containerIp = await runtime.getContainerIp(agent.remoteId);
    if (!containerIp) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Container not running or no IP assigned");
      return;
    }
    hostname = containerIp;
    port = project.devPort;
  } else {
    // Server/terminal: connect to machine host via the published port
    if (!agent.hostPort) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("No host port mapped for this agent. Ensure the project has a dev port configured.");
      return;
    }
    hostname = machine.host;
    port = agent.hostPort;
  }

  const proxyReq = httpRequest(
    {
      hostname,
      port,
      path: subPath,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${hostname}:${port}`,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      const isRefused = err.message.includes("ECONNREFUSED");
      res.writeHead(502, { "Content-Type": "text/html" });
      res.end(
        `<html><body style="font-family:monospace;background:#09090b;color:#a1a1aa;padding:2rem;max-width:40rem">` +
        `<h2 style="color:#f87171;font-size:1rem">Could not connect to dev server</h2>` +
        `<p style="font-size:0.85rem;color:#71717a">${err.message}</p>` +
        (isRefused
          ? `<p style="font-size:0.85rem;margin-top:1rem">Common causes:</p>` +
            `<ul style="font-size:0.85rem;color:#71717a;padding-left:1.5rem">` +
            `<li>Dev server isn't running yet — start it in the terminal</li>` +
            `<li>Dev server is listening on localhost only — add <code style="color:#d4d4d8">--host 0.0.0.0</code> to your dev command</li>` +
            `<li>Port mismatch — check that the dev port in project settings matches your server</li>` +
            `</ul>`
          : "") +
        `</body></html>`
      );
    }
  });

  req.pipe(proxyReq);
}
