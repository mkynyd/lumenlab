import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekAdapter } from "./deepseek-adapter";
import { MiniMaxAdapter } from "./minimax-adapter";
import { BailianQwenAdapter } from "./bailian-qwen-adapter";
import { call, collect, completed, image, mockSse, params, tool } from "./responses-test-helpers";
import type { ResponsesStreamEvent } from "../providers/responses/types";
import { runAgentLoop } from "../loop/agent-loop";
afterEach(() => vi.unstubAllGlobals());
const cases = [
  { model: "deepseek-flash", adapter: () => new DeepSeekAdapter("sk-test"), url: "https://api.deepseek.com/responses", nativeName: "web_search", toolId: "web.search" },
  { model: "minimax-m3", adapter: () => new MiniMaxAdapter("sk-test"), url: "https://api.minimax.cn/v1/responses", nativeName: "project_ufiles_dlist", toolId: "project_files.list" },
  { model: "qwen3.8-flash", adapter: () => new BailianQwenAdapter("ba-test", "https://workspace.example/compatible-mode/v1"), url: "https://workspace.example/compatible-mode/v1/responses", nativeName: "project_ufiles_dlist", toolId: "project_files.list" },
];
describe.each(cases)("$model Responses integration", ({ model, adapter, url, nativeName, toolId }) => {
  it("streams and accounts for a round with no tools before the Runtime can mark it complete", async () => {
    mockSse([{ type: "response.output_text.delta", delta: "answer" }, completed]);
    const instance = adapter();
    const initialRound = await instance.startRound({ ...params, model, activeTools: [] });
    const onModelEvent = vi.fn();
    const result = await runAgentLoop({
      ...params, model, provider: instance, initialRound, activeTools: [],
      context: { userId: "u", conversationId: "c", sessionApprovals: new Map() },
      signal: new AbortController().signal,
      toolRunner: { run: vi.fn() }, emit: vi.fn(), audit: vi.fn(), onModelEvent,
    });
    expect(onModelEvent).toHaveBeenCalledWith({ type: "text_delta", text: "answer" });
    expect(result.usage?.total_tokens).toBe(14);
    expect(result.status).toBe("completed");
  });

  it("never calls tools or reports loop completion for an incomplete provider round", async () => {
    mockSse([call("c1", nativeName), { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }]);
    const instance = adapter();
    const initialRound = await instance.startRound({ ...params, model, activeTools: [] });
    const run = vi.fn();
    await expect(runAgentLoop({
      ...params, model, provider: instance, initialRound, activeTools: [],
      context: { userId: "u", conversationId: "c", sessionApprovals: new Map() },
      signal: new AbortController().signal,
      toolRunner: { run }, emit: vi.fn(), audit: vi.fn(),
    })).rejects.toMatchObject({ name: "ResponsesTerminalError", terminal: { status: "incomplete" } });
    expect(run).not.toHaveBeenCalled();
  });
  it("normalizes text/reasoning/done and usage into the existing application events", async () => {
    const { requests } = mockSse([
      { type: "response.reasoning_text.delta", item_id: "r1", delta: "先想" },
      { type: "response.reasoning_text.done", item_id: "r1", text: "先想" },
      { type: "response.output_text.delta", item_id: "m1", delta: "你好" },
      { type: "response.output_text.done", item_id: "m1", text: "你好！" },
      completed,
    ]);
    const round = await adapter().startRound({ ...params, model, activeTools: [] });
    expect(await collect(round.events)).toEqual([
      { type: "reasoning_delta", text: "先想" }, { type: "text_delta", text: "你好" }, { type: "text_delta", text: "！" },
      { type: "usage", usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, prompt_cache_hit_tokens: 3, prompt_cache_miss_tokens: 7 } },
    ]);
    expect(requests[0].url).toBe(url);
    expect(round.getRawContent()).toBe("你好！");
    expect(round.getUsage()?.total_tokens).toBe(14);
  });
  it("preserves distinct call ids and replays the original image on its original user turn", async () => {
    const { requests } = mockSse([call("c1", nativeName), call("c2", nativeName), completed]);
    const instance = adapter();
    const first = await instance.startRound({ ...params, model, attachments: [image], activeTools: [tool(toolId)] });
    await collect(first.events);
    expect(first.getToolCalls().map((c) => c.id)).toEqual(["c1", "c2"]);
    const second = await instance.continueRound({ ...params, model, messages: first.requestMessages, attachments: [], activeTools: [tool(toolId)], toolCalls: first.getToolCalls(), toolResults: first.getToolCalls().map((c) => ({ toolUseId: c.id, content: "ok" })), rawContent: "", stopInstruction: "总结" });
    await collect(second.events);
    const body = requests[1].body;
    expect(body.input[0]).toMatchObject({ role: "user", content: [{ type: "input_text", text: "问题" }, { type: "input_image", image_url: "data:image/png;base64,cG5n" }] });
    expect(JSON.stringify(body).match(/data:image/g)).toHaveLength(1);
    expect(body.input.filter((i) => i.type === "function_call_output")).toEqual([
      { type: "function_call_output", call_id: "c1", output: "ok" }, { type: "function_call_output", call_id: "c2", output: "ok" },
    ]);
    expect(body).not.toHaveProperty("tools");
    expect(body.input.at(-1)).toEqual({ role: "user", content: [{ type: "input_text", text: "总结" }] });
  });
  it.each([
    ["incomplete", { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }],
    ["failed", { type: "response.failed", response: { error: { code: "server_error", message: "boom" } } }],
    ["refused", { type: "response.incomplete", response: { incomplete_details: { reason: "content_filter" } } }],
  ] as Array<[string, ResponsesStreamEvent]>)("does not expose tools or report success for %s", async (status, event) => {
    mockSse([call("c1", nativeName), { ...event, response: { ...event.response, usage: { input_tokens: 5, output_tokens: 2 } } }]);
    const result = await adapter().stream({ ...params, model });
    await expect(collect(result.stream)).rejects.toMatchObject({ name: "ResponsesTerminalError", terminal: { status } });
    expect(result.getToolCalls()).toEqual([]);
    expect(result.getUsage()?.total_tokens).toBe(7);
  });
  it("rejects an EOF without a terminal event", async () => {
    mockSse([{ type: "response.output_text.delta", delta: "partial" }]);
    const result = await adapter().stream({ ...params, model });
    await expect(collect(result.stream)).rejects.toMatchObject({ name: "ResponsesStreamInterruptedError", reason: "eof_without_terminal" });
  });
  it("preserves HTTP status and Retry-After", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429, headers: { "retry-after": "2" } })));
    await expect(adapter().stream({ ...params, model })).rejects.toMatchObject({ status: 429, retryable: true, retryAfterMs: 2000 });
  });
  it("cancels the upstream response when the reader is cancelled", async () => {
    let wireSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      wireSignal = init.signal;
      return new Response(new ReadableStream({ start(controller) { wireSignal?.addEventListener("abort", () => controller.error(wireSignal?.reason), { once: true }); } }));
    }));
    const result = await adapter().stream({ ...params, model });
    const reader = result.stream.getReader();
    const read = reader.read();
    await reader.cancel();
    await read;
    expect(wireSignal?.aborted).toBe(true);
  });
  it("rejects an unknown model before sending HTTP", async () => {
    const { fetchMock } = mockSse();
    await expect(adapter().stream({ ...params, model: "unknown-model" })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
