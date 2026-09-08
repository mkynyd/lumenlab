import { afterEach, describe, expect, it, vi } from "vitest";
import { MiniMaxAdapter } from "./minimax-adapter";
import { collect, completed, mockSse, params, tool } from "./responses-test-helpers";
afterEach(() => vi.unstubAllGlobals());
describe("MiniMax Responses adapter", () => {
  it("does not turn XML text into executable tools", async () => {
    mockSse([{ type: "response.output_text.delta", delta: '<tool_calls><invoke name="project_files.list"></invoke></tool_calls>' }, completed]);
    const round = await new MiniMaxAdapter("sk-test").startRound({ ...params, model: "minimax-m3", activeTools: [tool("project_files.list")] });
    await collect(round.events);
    expect(round.getToolCalls()).toEqual([]);
  });
  it("explicitly enables adaptive thinking and removes unprovenanced historical reasoning", async () => {
    const { requests } = mockSse();
    const round = await new MiniMaxAdapter("sk-test").startRound({ ...params, model: "minimax-m3", messages: [{ role: "assistant", content: "answer", reasoning_content: "private" }, { role: "user", content: "continue" }], activeTools: [] });
    await collect(round.events);
    expect(requests[0].body.reasoning).toEqual({ effort: "high" });
    expect(requests[0].body.model).toBe("MiniMax-M3");
    expect(JSON.stringify(requests[0].body)).not.toContain("private");
    expect(round.requestMessages[0]).not.toHaveProperty("reasoning_content");
  });
});
