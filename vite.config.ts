import path from "path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import type { Plugin } from "vite";

function dindangWebSocket(): Plugin {
  return {
    name: "dindang-ws",
    configureServer(server) {
      server.httpServer?.on("listening", async () => {
        const { attachTerminalWebSocket } = await import("./src/server/terminal.ts");
        attachTerminalWebSocket(server.httpServer!);
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), dindangWebSocket()],
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(process.env.SUPABASE_URL),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(process.env.SUPABASE_ANON_KEY),
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
});
