import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readChatError,
  requestToolApproval,
  toolApprovalEvent,
} from "./use-chat";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readChatError", () => {
  it("falls back to the HTTP status when an error response has no body", async () => {
    await expect(readChatError(new Response(null, { status: 500 }))).resolves.toBe(
      "Request failed (500)"
    );
  });

  it("uses JSON error bodies when they are present", async () => {
    await expect(
      readChatError(Response.json({ error: "模型服务不可用" }, { status: 502 }))
    ).resolves.toBe("模型服务不可用");
  });
});

describe("requestToolApproval", () => {
  it("throws on a non-2xx response so the approval UI stays pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "ToolExecution 已被其他请求执行" },
          { status: 409 }
        )
      )
    );

    await expect(
      requestToolApproval({
        executionId: "execution-1",
        token: "token-1.secret",
        scope: "once",
      })
    ).rejects.toThrow("ToolExecution 已被其他请求执行");
  });

  it("returns the completed result summary from a successful approval", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: true,
          status: "succeeded",
          scope: "once",
          executionId: "execution-1",
          resultSummary: { saved: true },
        })
      )
    );

    await expect(
      requestToolApproval({
        executionId: "execution-1",
        token: "token-1.secret",
        scope: "once",
      })
    ).resolves.toEqual({
      ok: true,
      status: "succeeded",
      scope: "once",
      executionId: "execution-1",
      resultSummary: { saved: true },
    });
  });

  it("returns a terminal tool failure separately from approval transport errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: false,
          status: "failed",
          scope: "once",
          executionId: "execution-1",
          error: { code: "HANDLER_ERROR", message: "工具执行失败" },
        })
      )
    );

    await expect(
      requestToolApproval({
        executionId: "execution-1",
        token: "token-1.secret",
        scope: "once",
      })
    ).resolves.toMatchObject({
      ok: false,
      status: "failed",
      error: { code: "HANDLER_ERROR", message: "工具执行失败" },
    });
  });
});

describe("toolApprovalEvent", () => {
  it("maps approved handler failures to a tool_failed timeline event", () => {
    expect(
      toolApprovalEvent({
        ok: false,
        status: "failed",
        scope: "once",
        executionId: "execution-1",
        error: { code: "HANDLER_ERROR", message: "工具执行失败" },
      })
    ).toEqual({
      type: "tool_failed",
      executionId: "execution-1",
      errorCode: "HANDLER_ERROR",
      error: "工具执行失败",
    });
  });
});
