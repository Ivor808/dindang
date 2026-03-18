/**
 * Production server for dindang.
 *
 * Serves the TanStack Start build, attaches WebSocket terminal,
 * agent hooks, preview proxy, and lifecycle handlers.
 *
 * Dev mode uses the Vite plugin (vite.config.ts) for the same wiring.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NodeRequest, sendNodeResponse } from "srvx/node";
import { attachTerminalWebSocket } from "./src/server/terminal.ts";
import { agentHooksMiddleware } from "./src/server/agent-hooks.ts";
import { previewProxyMiddleware } from "./src/server/preview-proxy.ts";
import {
  registerShutdownHandlers,
  reconcileOnStartup,
} from "./src/server/lifecycle.ts";

const PORT = parseInt(process.env.PORT || "3000", 10);
const DIST_CLIENT = join(import.meta.dirname, "dist", "client");

// Import the TanStack Start production fetch handler
const startServer = await import("./dist/server/server.js");

// Serve static files from dist/client
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function tryServeStatic(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
): boolean {
  const url = req.url ?? "/";
  if (url.startsWith("/_serverFn") || url.startsWith("/api/")) return false;

  let normalized: string;
  try {
    normalized = url === "/" ? "index.html" : decodeURIComponent(url);
  } catch {
    return false;
  }
  const filePath = resolve(DIST_CLIENT, normalized.replace(/^\/+/, ""));
  if (!filePath.startsWith(DIST_CLIENT)) return false;
  try {
    const data = readFileSync(filePath);
    const ext = filePath.slice(filePath.lastIndexOf("."));
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": url.includes("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

// SPA shell fallback
let shellHtml: string;
try {
  shellHtml = readFileSync(join(DIST_CLIENT, "_shell.html"), "utf-8");
} catch {
  shellHtml = readFileSync(join(DIST_CLIENT, "index.html"), "utf-8");
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  // Agent hooks API
  if (url.startsWith("/api/hooks/")) {
    agentHooksMiddleware(req, res, () => {
      res.writeHead(404);
      res.end();
    });
    return;
  }

  // Preview proxy
  if (url.startsWith("/preview/")) {
    previewProxyMiddleware(req, res, () => {
      res.writeHead(404);
      res.end();
    });
    return;
  }

  // Static files from dist/client
  if (tryServeStatic(req, res)) return;

  // TanStack Start server functions (/_serverFn/*)
  if (url.startsWith("/_serverFn")) {
    try {
      const webReq = new NodeRequest({ req, res });
      const webRes = await startServer.default.fetch(webReq);
      return sendNodeResponse(res, webRes);
    } catch (e) {
      console.error("[server] server function error:", e);
      res.writeHead(500);
      res.end("Internal Server Error");
      return;
    }
  }

  // SPA fallback — serve shell HTML for all other routes
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(shellHtml);
});

// Attach WebSocket terminal handler
attachTerminalWebSocket(server);

// Lifecycle
registerShutdownHandlers();
reconcileOnStartup();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] dindang listening on http://0.0.0.0:${PORT}`);
});
