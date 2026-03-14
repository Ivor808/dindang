import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { agents, machines } from "~/db/schema";
import { getRuntimeForMachine } from "~/server/machine-registry";
import { toErrorMessage } from "~/lib/errors";
import type { PTYSession } from "~/lib/transport";

const TERMINAL_PATH_RE = /^\/ws\/terminal\/(.+)$/;

const activeSessions = new Map<WebSocket, { pty: PTYSession }>();

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
    // Look up agent by name
    const agentRows = await db
      .select()
      .from(agents)
      .where(eq(agents.name, agentName))
      .limit(1);
    if (agentRows.length === 0) {
      throw new Error(`Agent not found: ${agentName}`);
    }
    const agent = agentRows[0]!;

    if (!agent.remoteId) {
      throw new Error("Agent has no remote ID");
    }
    if (!agent.machineId) {
      throw new Error("Agent has no machine");
    }

    // Look up the machine
    const machineRows = await db
      .select()
      .from(machines)
      .where(eq(machines.id, agent.machineId))
      .limit(1);
    if (machineRows.length === 0) {
      throw new Error("Machine not found");
    }
    const machine = machineRows[0]!;

    // Get runtime and transport
    const runtime = getRuntimeForMachine(machine);
    const transport = await runtime.getTransport(agent.remoteId);

    // Open PTY
    const pty = await transport.openPTY({ cwd: agent.workDir ?? "/root" });

    activeSessions.set(ws, { pty });

    const cleanup = () => {
      pty.close();
      activeSessions.delete(ws);
    };

    // Transport → browser
    pty.stream.on("data", (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });

    pty.stream.on("end", () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    pty.stream.on("error", () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("\r\n\x1b[31m[stream error]\x1b[0m\r\n");
        ws.close();
      }
      cleanup();
    });

    // Browser → transport
    ws.on("message", (data) => {
      const msg = data.toString();

      // Check for control messages (JSON with type field)
      if (msg.startsWith("{")) {
        try {
          const ctrl = JSON.parse(msg);
          if (ctrl.type === "resize" && ctrl.cols && ctrl.rows) {
            pty.resize(ctrl.cols, ctrl.rows);
            return;
          }
        } catch {
          // not JSON, treat as regular input
        }
      }

      if (Buffer.isBuffer(data)) {
        pty.stream.write(data);
      } else if (typeof data === "string") {
        pty.stream.write(data);
      } else if (data instanceof ArrayBuffer) {
        pty.stream.write(Buffer.from(data));
      } else {
        // data is Buffer[]
        pty.stream.write(Buffer.concat(data as Buffer[]));
      }
    });

    ws.on("close", cleanup);
    ws.on("error", cleanup);
  } catch (e) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\r\nFailed to connect: ${toErrorMessage(e)}\r\n`);
      ws.close();
    }
  }
}
