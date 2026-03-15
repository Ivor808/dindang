import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { eq } from "drizzle-orm";
import { db } from "~/db";
import { agents, machines } from "~/db/schema";
import { getRuntimeForMachine } from "~/server/machine-registry";
import { toErrorMessage } from "~/lib/errors";
import type { PTYSession } from "~/lib/transport";

const TERMINAL_PATH_RE = /^\/ws\/terminal\/(.+)$/;

/** Max scrollback bytes to buffer for reconnection replay */
const MAX_SCROLLBACK = 256 * 1024; // 256 KB

interface PersistentSession {
  pty: PTYSession;
  scrollback: Buffer[];
  scrollbackSize: number;
  attachedWs: WebSocket | null;
  /** Timer that destroys the session after prolonged disconnect */
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/** PTY sessions keyed by agent name — survive WebSocket disconnects */
const sessions = new Map<string, PersistentSession>();

/** How long an unattached session stays alive before being cleaned up */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

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

/** Destroy a persistent session and clean up all resources */
function destroySession(agentName: string): void {
  const session = sessions.get(agentName);
  if (!session) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.pty.close();
  sessions.delete(agentName);
}

/** Detach the WebSocket from a session without killing the PTY */
function detachWs(agentName: string): void {
  const session = sessions.get(agentName);
  if (!session) return;
  session.attachedWs = null;

  // Start idle timer — if nobody reconnects, clean up
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => destroySession(agentName), IDLE_TIMEOUT_MS);
}

async function handleConnection(ws: WebSocket, agentName: string): Promise<void> {
  try {
    const existing = sessions.get(agentName);

    if (existing) {
      // Reconnect to existing session
      if (existing.idleTimer) {
        clearTimeout(existing.idleTimer);
        existing.idleTimer = null;
      }

      // Detach previous WebSocket if still connected
      if (existing.attachedWs && existing.attachedWs.readyState === WebSocket.OPEN) {
        existing.attachedWs.close();
      }
      existing.attachedWs = ws;

      // Replay scrollback buffer so the user sees previous output
      for (const chunk of existing.scrollback) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(chunk);
        }
      }

      wireWsToSession(ws, agentName, existing);
      return;
    }

    // No existing session — create a new one
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
    const pty = await transport.openPTY({ cwd: cwdExists ? cwd : "/home/dev" });

    const session: PersistentSession = {
      pty,
      scrollback: [],
      scrollbackSize: 0,
      attachedWs: ws,
      idleTimer: null,
    };
    sessions.set(agentName, session);

    // PTY output → scrollback buffer + WebSocket
    pty.stream.on("data", (chunk: Buffer) => {
      // Append to scrollback
      session.scrollback.push(chunk);
      session.scrollbackSize += chunk.length;

      // Trim scrollback if over limit
      while (session.scrollbackSize > MAX_SCROLLBACK && session.scrollback.length > 1) {
        const removed = session.scrollback.shift()!;
        session.scrollbackSize -= removed.length;
      }

      // Forward to attached WebSocket
      if (session.attachedWs?.readyState === WebSocket.OPEN) {
        session.attachedWs.send(chunk);
      }
    });

    pty.stream.on("end", () => {
      if (session.attachedWs?.readyState === WebSocket.OPEN) {
        session.attachedWs.send("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
        session.attachedWs.close();
      }
      destroySession(agentName);
    });

    pty.stream.on("error", () => {
      if (session.attachedWs?.readyState === WebSocket.OPEN) {
        session.attachedWs.send("\r\n\x1b[31m[stream error]\x1b[0m\r\n");
        session.attachedWs.close();
      }
      destroySession(agentName);
    });

    wireWsToSession(ws, agentName, session);
  } catch (e) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\r\nFailed to connect: ${toErrorMessage(e)}\r\n`);
      ws.close();
    }
  }
}

/** Wire a WebSocket's input/close events to a persistent session */
function wireWsToSession(ws: WebSocket, agentName: string, session: PersistentSession): void {
  ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
    const buf = Buffer.isBuffer(data)
      ? data
      : data instanceof ArrayBuffer
        ? Buffer.from(data)
        : Buffer.concat(data);

    // Fast path: check first byte for '{' before attempting JSON parse
    if (buf[0] === 0x7b) {
      try {
        const ctrl = JSON.parse(buf.toString());
        if (ctrl.type === "resize" && ctrl.cols && ctrl.rows) {
          session.pty.resize(ctrl.cols, ctrl.rows);
          return;
        }
      } catch {
        // not JSON, treat as regular input
      }
    }

    session.pty.stream.write(buf);
  });

  // On WebSocket close, detach but keep PTY alive
  ws.on("close", () => detachWs(agentName));
  ws.on("error", () => detachWs(agentName));
}

/** Force-destroy a session for an agent (called on agent removal) */
export function destroyAgentSession(agentName: string): void {
  destroySession(agentName);
}
