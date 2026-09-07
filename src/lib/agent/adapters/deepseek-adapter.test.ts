import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekAdapter } from "./deepseek-adapter";
import { call, collect, completed, mockSse, params, tool } from "./responses-test-helpers";
afterEach(() => vi.unstubAllGlobals());
const model = "deepseek-v4-flash-vision-exp";

describe("DeepSeek Responses adapter", () => {
  it("keeps client function name mapping and XML fallback inside the adapter", async () => {
    const { requests } = mockSse([
      call("c1", "web_search"),
      { type: "response.output_text.delta", delta: '<tool_calls><invoke name="project_files.list"><parameter name="projectId">p1</parameter></invoke></tool_calls>' },
      completed,
    ]);
    const adapter = new DeepSeekAdapter("sk-test");
    const first = await adapter.startRound({ ...params, model, activeTools: [tool("web.search"), tool("project_files.list")] });
    await collect(first.events);
    expect(requests[0].body.tools).toEqual([{ type: "function", name: "web_search", description: "web.search description", parameters: { type: "object", properties: {} } }]);
    expect(requests[0].body.instructions).toContain("<tool_calls>");
    expect(first.getToolCalls()).toMatchObject([
      { id: "c1", name: "web.search", source: "native" },
      { name: "project_files.list", source: "xml_dsml" },
    ]);
    const second = await adapter.continueRound({ ...params, model, messages: first.requestMessages, activeTools: [tool("web.search"), tool("project_files.list")], toolCalls: first.getToolCalls(), toolResults: first.getToolCalls().map((c) => ({ toolUseId: c.id, content: "ok" })), rawContent: first.getRawContent() });
    await collect(second.events);
    expect(requests[1].body.instructions?.match(/你可以调用以下工具/g)).toHaveLength(1);
    expect(requests[1].body.input).toContainEqual({ type: "function_call", call_id: "c1", name: "web_search", arguments: '{"projectId":"p1"}' });
    expect(requests[1].body.input).toContainEqual({ type: "function_call_output", call_id: "c1", output: "ok" });
    expect(JSON.stringify(requests[1].body.input)).toContain("XML 工具结果");
    expect(requests[1].body.input.filter((i) => i.type === "function_call")).toHaveLength(1);
  });
});
