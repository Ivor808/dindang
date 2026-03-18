import path from "path";
import { execSync } from "child_process";
import { defineConfig, loadEnv } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import type { Plugin } from "vite";

function dindangServer(): Plugin {
  return {
    name: "dindang-server",
    configureServer(server) {
      let proxyMiddleware: ((req: any, res: any, next: () => void) => void) | null = null;

      // Load preview proxy once at startup, then use as middleware
      server.httpServer?.on("listening", async () => {
        try {
          const termMod = await server.ssrLoadModule("./src/server/terminal.ts");
          (termMod.attachTerminalWebSocket as (s: typeof server.httpServer) => void)(server.httpServer!);
        } catch (e) {
          console.error("Failed to attach terminal WebSocket:", e);
        }
        try {
          const proxyMod = await server.ssrLoadModule("./src/server/preview-proxy.ts");
          proxyMiddleware = proxyMod.previewProxyMiddleware as any;
        } catch (e) {
          console.error("Failed to load preview proxy:", e);
        }
        // Lifecycle: register shutdown handlers and reconcile orphaned containers
        try {
          const lifecycle = await server.ssrLoadModule("./src/server/lifecycle.ts");
          (lifecycle.registerShutdownHandlers as () => void)();
          (lifecycle.reconcileOnStartup as () => Promise<void>)();
        } catch (e) {
          console.error("Failed to init lifecycle:", e);
        }
      });

      // Middleware that delegates to the loaded modules
      let hooksMiddleware: ((req: any, res: any, next: () => void) => void) | null = null;
      server.httpServer?.on("listening", async () => {
        try {
          const hooksMod = await server.ssrLoadModule("./src/server/agent-hooks.ts");
          hooksMiddleware = hooksMod.agentHooksMiddleware as any;
        } catch (e) {
          console.error("Failed to load agent hooks:", e);
        }
      });

      server.middlewares.use((req, res, next) => {
        if (hooksMiddleware && req.url?.startsWith("/api/hooks/")) {
          hooksMiddleware(req, res, next);
        } else if (proxyMiddleware && req.url?.startsWith("/preview/")) {
          proxyMiddleware(req, res, next);
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
  plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), dindangServer()],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(env.VITE_SUPABASE_URL),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(env.VITE_SUPABASE_ANON_KEY),
    "import.meta.env.VITE_DINDANG_MODE": JSON.stringify(env.DINDANG_MODE || "local"),
    "import.meta.env.VITE_DINDANG_VERSION": JSON.stringify(
      process.env.DINDANG_VERSION || (() => { try { return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim(); } catch { return "dev"; } })()
    ),
  },
  resolve: {
    alias: {
      "~": path.resolve(import.meta.dirname, "./src"),
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
};
});
