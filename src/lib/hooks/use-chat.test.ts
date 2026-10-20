import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readChatError,
  requestToolApproval,
  toolApprovalEvent,
  useChat,
} from "./use-chat";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

describe("useChat conversation URL sync", () => {
  function createWrapper() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    };
  }

  function sseChatResponse(conversationId?: string) {
    const headers = new Headers({ "Content-Type": "text/event-stream" });
    if (conversationId) headers.set("X-Conversation-Id", conversationId);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers });
  }

  function stubChatFetch(conversationId?: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/chat/models") {
          return Response.json({ models: ["qwen3.8-flash", "deepseek-flash", "minimax-m3.1"] });
        }
        if (url === "/api/chat") return sseChatResponse(conversationId);
        if (url.startsWith("/api/conversations/")) {
          return Response.json({ title: "新对话" });
        }
        throw new Error(`unexpected fetch ${url}`);
      })
    );
  }

  beforeEach(() => {
    window.history.replaceState(null, "", "/chat");
  });

  it("does not retry stale approval records from an already completed historical task", async () => {
    const fetchMock = vi.fn(async () => Response.json({ models: ["deepseek-flash"] }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChat({ initialMessages: [{ id: "old", role: "assistant", content: "已完成", process: {
      status: "completed", tools: [{ executionId: "old-pending", toolId: "artifact.save", label: "保存", sources: [], status: "awaiting_approval",
        approval: { expiresAt: Date.now() + 60_000, canApproveSession: false } }],
    } }] }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.modelBlockedReason).toBeUndefined());
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("acknowledges acceptance before the response stream completes and never serializes the callback", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let requestBody = "";
    const accepted = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/chat") {
        requestBody = String(init?.body);
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }));
      }
      return Response.json({ models: ["deepseek-flash"] });
    }));
    const { result } = renderHook(() => useChat(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.modelBlockedReason).toBeUndefined());
    let sending!: ReturnType<typeof result.current.sendMessage>;
    act(() => { sending = result.current.sendMessage({ content: "教案", onAccepted: accepted }); });
    await waitFor(() => expect(accepted).toHaveBeenCalledTimes(1));
    expect(result.current.isStreaming).toBe(true);
    expect(requestBody).not.toContain("onAccepted");
    await act(async () => { stream.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); stream.close(); await sending; });
    expect(accepted).toHaveBeenCalledTimes(1);
  });

  it.each(["initial", "loaded"])("approves a %s persisted card without a transient timeline entry", async (source) => {
    const message = {
      id: "persisted-assistant", role: "assistant" as const, content: "",
      process: {
        status: "running" as const,
        tools: [{ executionId: "pending-tool", toolId: "artifact.save", label: "保存教案",
          status: "awaiting_approval" as const, sources: [],
          approval: { token: "", expiresAt: Date.now() + 60_000, canApproveSession: true } }],
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/agent/approve") return Response.json({
        ok: true, status: "succeeded", scope: "once", executionId: "pending-tool", resultSummary: { saved: true },
      });
      return Response.json({ models: ["deepseek-flash"] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChat({
      initialConversationId: "existing", initialMessages: source === "initial" ? [message] : [],
    }), { wrapper: createWrapper() });
    if (source === "loaded") act(() => result.current.loadConversation("existing", [message]));
    expect(result.current.agentTimeline).toEqual({});
    await waitFor(() => expect(result.current.messages[0].process?.tools[0].status).toBe("completed"));
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/approve", expect.objectContaining({
      body: JSON.stringify({ executionId: "pending-tool", token: "", scope: "once" }),
    }));
    expect(result.current.messages[0].process?.tools[0].status).toBe("completed");
    expect(result.current.error).toBeNull();
  });

  it("keeps a restored approval pending when server ownership validation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input) === "/api/agent/approve"
        ? Response.json({ error: "无权审批" }, { status: 403 })
        : Response.json({ models: ["deepseek-flash"] })
    ));
    const { result } = renderHook(() => useChat(), { wrapper: createWrapper() });
    await act(async () => {
      await expect(result.current.approveExecution("other-tool", "token", "once")).rejects.toThrow("无权审批");
    });
    expect(result.current.error).toBe("无权审批");
  });

  it.each(["approve", "reject"])("does not apply a late %s result or continuation to another conversation", async (action) => {
    let resolveApproval!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/agent/")) return new Promise<Response>((resolve) => { resolveApproval = resolve; });
      return Response.json({ models: ["deepseek-flash"] });
    }));
    const { result } = renderHook(() => useChat({ initialConversationId: "old" }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.modelBlockedReason).toBeUndefined());
    let approval!: Promise<void>;
    act(() => { approval = action === "approve"
      ? result.current.approveExecution("pending-tool", "", "once")
      : result.current.rejectExecution("pending-tool"); });
    act(() => result.current.loadConversation("new", [{ id: "new-user", role: "user", content: "new conversation" }]));
    await act(async () => {
      resolveApproval(Response.json({ ok: true, status: "succeeded", scope: "once",
        executionId: "pending-tool", resultSummary: {}, shouldContinue: true }));
      await approval;
    });
    expect(result.current.conversationId).toBe("new");
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.agentTimeline).toEqual({});
    expect(result.current.error).toBeNull();
  });

  it("updates only the restored tool's message after rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/agent/reject"
      ? Response.json({ ok: true, shouldContinue: false }) : Response.json({ models: ["deepseek-flash"] })));
    const trace = (executionId: string) => ({ status: "running" as const, tools: [{
      executionId, toolId: "artifact.save", label: "保存", status: "awaiting_approval" as const, sources: [],
    }] });
    const { result } = renderHook(() => useChat({ initialMessages: [
      { id: "old", role: "assistant", content: "", process: trace("pending-tool") },
      { id: "other", role: "assistant", content: "", isStreaming: true, process: trace("other-tool") },
    ] }), { wrapper: createWrapper() });
    await act(async () => { await result.current.rejectExecution("pending-tool"); });
    expect(result.current.messages[0].process?.tools[0].status).toBe("failed");
    expect(result.current.messages[1].process?.tools).toHaveLength(1);
    expect(result.current.messages[1].process?.tools[0].status).toBe("awaiting_approval");
  });

  it("retains unavailable Qwen until the user explicitly selects an alternative", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      models: ["minimax-m3.1"], unavailableReasons: { "qwen3.8-flash": "Qwen 暂未开放" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useChat({ model: "qwen3.8-flash" }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.modelBlockedReason).toBe("Qwen 暂未开放"));
    expect(result.current.model).toBe("qwen3.8-flash");
    await act(async () => { expect(await result.current.sendMessage("hello")).toBe(false); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toHaveLength(0);
    act(() => result.current.setModel("minimax-m3.1"));
    expect(result.current.modelBlockedReason).toBeUndefined();
  });

  it.each([
    ["minimax-m3.1", "minimax-m3.1"],
    ["deepseek-v4-pro", "deepseek-flash"],
    ["qwen3.7-plus", "qwen3.8-flash"],
  ])("restores %s and resets an ordinary new chat to DeepSeek", async (saved, expected) => {
    stubChatFetch();
    const { result } = renderHook(() => useChat({ initialConversationId: "existing", model: saved }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.modelBlockedReason).toBeUndefined());
    expect(result.current.model).toBe(expected);
    act(() => result.current.newConversation());
    await act(async () => {});
    expect(result.current.model).toBe("deepseek-flash");
  });

  it("waits for project settings and inherits its model before the first request", async () => {
    stubChatFetch("project-chat");
    const { result, rerender } = renderHook(
      ({ model, loading }: { model?: string; loading: boolean }) => useChat({ projectId: "project", model, modelLoading: loading }),
      { wrapper: createWrapper(), initialProps: { model: undefined as string | undefined, loading: true } }
    );
    await act(async () => { expect(await result.current.sendMessage("hello")).toBe(false); });
    rerender({ model: "minimax-m3.1", loading: false });
    await waitFor(() => expect(result.current.model).toBe("minimax-m3.1"));
    await act(async () => { await result.current.sendMessage("hello"); });
    const calls = vi.mocked(fetch).mock.calls;
    const sent = calls.find(([url]) => url === "/api/chat");
    expect(JSON.parse(sent![1]!.body as string).model).toBe("minimax-m3.1");
  });

  it("moves /chat to /chat/<id> in place when the first send creates a conversation", async () => {
    stubChatFetch("conv-new-1");
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.modelBlockedReason).toBeUndefined());
    await act(async () => {
      await result.current.sendMessage("你好");
    });

    expect(result.current.conversationId).toBe("conv-new-1");
    expect(window.location.pathname).toBe("/chat/conv-new-1");
  });

  it("does not touch the URL when the conversation already existed", async () => {
    stubChatFetch("conv-existing-1");
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(
      () => useChat({ initialConversationId: "conv-existing-1" }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.modelBlockedReason).toBeUndefined());
    await act(async () => {
      await result.current.sendMessage("继续");
    });

    expect(result.current.conversationId).toBe("conv-existing-1");
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/chat");
  });

  it("keeps the project page URL when a project send creates a conversation", async () => {
    stubChatFetch("conv-new-1");
    window.history.replaceState(null, "", "/projects/proj-1");
    const { result } = renderHook(() => useChat({ projectId: "proj-1" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.modelBlockedReason).toBeUndefined());
    await act(async () => {
      await result.current.sendMessage("你好");
    });

    expect(result.current.conversationId).toBe("conv-new-1");
    expect(window.location.pathname).toBe("/projects/proj-1");
  });

  it("calls the execution cancel endpoint when aborting a durable stream", async () => {
    const cancelCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/chat/models") {
          return Response.json({ models: ["qwen3.8-flash", "deepseek-flash", "minimax-m3.1"] });
        }
        if (url === "/api/chat") {
          const headers = new Headers({
            "Content-Type": "text/event-stream",
            "X-Agent-Execution-Id": "exec-1",
          });
          // 永不产出内容的流；本地 abort 时像真实 fetch 一样让流报错
          const body = new ReadableStream<Uint8Array>({
            start(streamController) {
              init?.signal?.addEventListener("abort", () => {
                streamController.error(
                  new DOMException("The operation was aborted.", "AbortError")
                );
              });
            },
          });
          return new Response(body, { status: 200, headers });
        }
        if (url === "/api/agent/executions/exec-1/cancel") {
          cancelCalls.push(url);
          return Response.json({ ok: true });
        }
        throw new Error(`unexpected fetch ${url}`);
      })
    );
    const { result } = renderHook(() => useChat(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.modelBlockedReason).toBeUndefined());
    act(() => {
      void result.current.sendMessage("你好");
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    act(() => {
      result.current.abort();
    });

    expect(cancelCalls).toEqual(["/api/agent/executions/exec-1/cancel"]);
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
  });
});
