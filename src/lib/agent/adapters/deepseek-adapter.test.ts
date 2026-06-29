import { describe, expect, it, vi } from "vitest";
import { DeepSeekAdapter } from "./deepseek-adapter";
import * as deepseek from "@/lib/deepseek";

vi.mock("@/lib/deepseek", async (importOriginal) => {
  const original = await importOriginal<typeof deepseek>();
  return {
    ...original,
    streamChat: vi.fn(),
  };
});

describe("DeepSeekAdapter", () => {
  it("forwards stream params and returns tool calls", async () => {
    vi.mocked(deepseek.streamChat).mockResolvedValue({
      stream: new ReadableStream(),
      getUsage: () => ({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      }),
      getToolCalls: () => [
        { id: "tc-1", name: "web_search", input: { query: "test" } },
      ],
    });

    const adapter = new DeepSeekAdapter("sk-test");
    const result = await adapter.stream({
      model: "deepseek-v4-pro",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      thinkingEnabled: true,
      reasoningEffort: "max",
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });

    expect(deepseek.streamChat).toHaveBeenCalledWith("sk-test", {
      model: "deepseek-v4-pro",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      thinking: { type: "enabled" },
      reasoning_effort: "max",
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });
    expect(result.getToolCalls()).toHaveLength(1);
    expect(result.getUsage()?.total_tokens).toBe(15);
  });
});
