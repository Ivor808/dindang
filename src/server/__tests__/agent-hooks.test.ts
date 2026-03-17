import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";
import { EventEmitter } from "events";

// Mock the db module before importing the handler
vi.mock("~/db", () => {
  const updateSet = vi.fn().mockReturnThis();
  const updateWhere = vi.fn().mockResolvedValue(undefined);

  return {
    db: {
      update: vi.fn(() => ({
        set: updateSet.mockReturnValue({ where: updateWhere }),
      })),
      _mocks: { updateSet, updateWhere },
    },
  };
});

import { agentHooksMiddleware } from "../agent-hooks";
import { db } from "~/db";

const mocks = (db as any)._mocks;

function createReq(method: string, url: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = url;
  return req;
}

function createRes() {
  const res = {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agentHooksMiddleware", () => {
  it("ignores non-POST requests", () => {
    const next = vi.fn();
    const req = createReq("GET", "/api/hooks/agent/test/PreToolUse");
    const res = createRes();
    agentHooksMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("ignores non-matching paths", () => {
    const next = vi.fn();
    const req = createReq("POST", "/api/other");
    const res = createRes();
    agentHooksMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("responds 200 immediately on valid hook", async () => {
    const next = vi.fn();
    const req = createReq("POST", "/api/hooks/agent/my-agent/PreToolUse");
    const res = createRes();

    agentHooksMiddleware(req, res, next);
    req.emit("data", "{}");
    req.emit("end");

    // Allow async handleHook to run
    await vi.waitFor(() => {
      expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
      expect(res.end).toHaveBeenCalledWith("{}");
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("sets status to busy on PreToolUse", async () => {
    const req = createReq("POST", "/api/hooks/agent/my-agent/PreToolUse");
    const res = createRes();

    agentHooksMiddleware(req, res, vi.fn());
    req.emit("data", "");
    req.emit("end");

    await vi.waitFor(() => {
      expect(db.update).toHaveBeenCalled();
      expect(mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "busy" }),
      );
    });
  });

  it("sets status to busy on PostToolUse", async () => {
    const req = createReq("POST", "/api/hooks/agent/my-agent/PostToolUse");
    const res = createRes();

    agentHooksMiddleware(req, res, vi.fn());
    req.emit("data", "");
    req.emit("end");

    await vi.waitFor(() => {
      expect(mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "busy" }),
      );
    });
  });

  it("sets status to ready and clears busySince on Stop", async () => {
    const req = createReq("POST", "/api/hooks/agent/my-agent/Stop");
    const res = createRes();

    agentHooksMiddleware(req, res, vi.fn());
    req.emit("data", "");
    req.emit("end");

    await vi.waitFor(() => {
      expect(mocks.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ready", busySince: null }),
      );
    });
  });

  it("does not update DB for unknown event types", async () => {
    const req = createReq("POST", "/api/hooks/agent/my-agent");
    const res = createRes();

    agentHooksMiddleware(req, res, vi.fn());
    req.emit("data", "");
    req.emit("end");

    await new Promise((r) => setTimeout(r, 50));
    expect(db.update).not.toHaveBeenCalled();
  });
});
