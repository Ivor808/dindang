import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { agents, machines } from "~/db/schema";
import { getRuntimeForMachine } from "~/server/machine-registry";
import { toErrorMessage } from "~/lib/errors";

const TERMINAL_PATH_RE = /^\/ws\/terminal\/(.+)$/;

export function attachTerminalWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const match = req.url?.match(TERMINAL_PATH_RE);
    if (!match) return; // let Vite HMR handle other upgrades

    const agentName = match[1]!;
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, agentName);
    });
  });
}

async function handleConnection(ws: WebSocket, agentName: string): Promise<void> {
  try {
    const agentRows = await db
      .select()
      .from(agents)
      .where(eq(agents.name, agentName))
      .limit(1);
    if (agentRows.length === 0) throw new Error(`Agent not found: ${agentName}`);
    const agent = agentRows[0]!;

    if (!agent.remoteId) throw new Error("Agent has no remote ID");
    if (!agent.machineId) throw new Error("Agent has no machine");

    const machineRows = await db
      .select()
      .from(machines)
      .where(eq(machines.id, agent.machineId))
      .limit(1);
    if (machineRows.length === 0) throw new Error("Machine not found");
    const machine = machineRows[0]!;

    const runtime = getRuntimeForMachine(machine);
    const transport = await runtime.getTransport(agent.remoteId);

    const cwd = agent.workDir ?? "/home/dev";
    const cwdExists = await transport.fileExists(cwd);
    // openPTY uses tmux internally — each connection attaches to the same
    // tmux session ("main"). When this WS closes, tmux detaches and the
    // process (e.g. Claude Code) keeps running inside the container.
    const pty = await transport.openPTY({ cwd: cwdExists ? cwd : "/home/dev" });

    // Transport → browser
    pty.stream.on("data", (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });

    const cleanup = () => {
      pty.close();
    };

    pty.stream.on("end", () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
      cleanup();
    });

    pty.stream.on("error", () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("\r\n\x1b[31m[stream error]\x1b[0m\r\n");
        ws.close();
      }
      cleanup();
    });

    // Browser → transport
    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = Buffer.isBuffer(data)
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : Buffer.concat(data);

      // Check first byte for '{' — control messages (resize)
      if (buf[0] === 0x7b) {
        try {
          const ctrl = JSON.parse(buf.toString());
          if (ctrl.type === "resize" && ctrl.cols && ctrl.rows) {
            pty.resize(ctrl.cols, ctrl.rows);
            return;
          }
        } catch {
          // not JSON, treat as regular input
        }
      }

      pty.stream.write(buf);
    });

    // When WS closes, the docker exec ends and tmux detaches — process stays alive
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  } catch (e) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\r\nFailed to connect: ${toErrorMessage(e)}\r\n`);
      ws.close();
    }
  }
}

/** No-op — tmux sessions live inside the container, not in server memory.
 *  Kept for API compatibility with agents.ts imports. */
export function destroyAgentSession(_agentName: string): void {
  // tmux session is destroyed when the container is removed
}
