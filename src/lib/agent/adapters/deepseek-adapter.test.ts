import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekAdapter } from "./deepseek-adapter";
import { call, collect, completed, mockSse, params, tool } from "./responses-test-helpers";
afterEach(() => vi.unstubAllGlobals());
const model = "deepseek-flash";

describe("DeepSeek Responses adapter", () => {
  it.each(["high", "max"] as const)("reserves enough output for reasoning and the answer at %s effort", async (reasoningEffort) => {
    // Reproduce a thinking-only round exhausting the old shared 8192-token cap.
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const enough = body.max_output_tokens >= 65_536;
      const events = enough
        ? [{ type: "response.output_text.delta", delta: "完整教案" }, completed]
        : [{ type: "response.reasoning_text.delta", delta: "正在规划教案" }, {
            type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } },
          }];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
    }));
    const round = await new DeepSeekAdapter("sk-test").startRound({ ...params, reasoningEffort, model, activeTools: [] });
    expect(await collect(round.events)).toContainEqual({ type: "text_delta", text: "完整教案" });
  });

  it("uses native function calls for every platform tool and replays outputs by call id", async () => {
    const { requests } = mockSse([
      call("c1", "web_search"),
      call("c2", "project_ufiles_dlist"),
      completed,
    ]);
    const adapter = new DeepSeekAdapter("sk-test");
    const first = await adapter.startRound({ ...params, model, activeTools: [tool("web.search"), tool("project_files.list")] });
    await collect(first.events);
    expect(requests[0].body.tools).toEqual([
      { type: "function", name: "web_search", description: "web.search description", parameters: { type: "object", properties: {} } },
      { type: "function", name: "project_ufiles_dlist", description: "project_files.list description", parameters: { type: "object", properties: {} } },
    ]);
    expect(requests[0].body.instructions).not.toContain("<tool_calls>");
    expect(first.getToolCalls()).toMatchObject([
      { id: "c1", name: "web.search", source: "native" },
      { id: "c2", name: "project_files.list", source: "native" },
    ]);
    const second = await adapter.continueRound({ ...params, model, messages: first.requestMessages, activeTools: [tool("web.search"), tool("project_files.list")], toolCalls: first.getToolCalls(), toolResults: first.getToolCalls().map((c) => ({ toolUseId: c.id, content: "ok" })), rawContent: first.getRawContent() });
    await collect(second.events);
    expect(requests[1].body.input).toContainEqual({ type: "function_call", call_id: "c1", name: "web_search", arguments: '{"projectId":"p1"}' });
    expect(requests[1].body.input).toContainEqual({ type: "function_call_output", call_id: "c1", output: "ok" });
    expect(requests[1].body.input).toContainEqual({ type: "function_call", call_id: "c2", name: "project_ufiles_dlist", arguments: '{"projectId":"p1"}' });
    expect(requests[1].body.input).toContainEqual({ type: "function_call_output", call_id: "c2", output: "ok" });
    expect(requests[1].body.input.filter((i) => i.type === "function_call")).toHaveLength(2);
  });
});
