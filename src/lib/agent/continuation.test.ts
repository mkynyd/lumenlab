import { describe, expect, it, vi } from "vitest";
import { runContinuationLoop } from "./continuation";
import * as deepseek from "@/lib/deepseek";
import type { AgentEvent } from "./types";

vi.mock("@/lib/deepseek", async (importOriginal) => {
  const original = await importOriginal<typeof deepseek>();
  return {
    ...original,
    completeChat: vi.fn(),
  };
});

describe("agent continuation loop", () => {
  it("returns final messages and aggregates sources after one tool round", async () => {
    vi.mocked(deepseek.completeChat)
      .mockResolvedValueOnce({
        content: "I will search the project.\n\n```json\n{\"tool_calls\":[{\"name\":\"project_rag.search\",\"input\":{\"projectId\":\"p1\",\"query\":\"B+ tree\"}}]}\n```",
        usage: null,
      })
      .mockResolvedValueOnce({
        content: "B+ trees are balanced search trees.",
        usage: null,
      });

    const events: AgentEvent[] = [];
    const result = await runContinuationLoop({
      apiKey: "key",
      model: "deepseek-v4-pro",
      systemPrompt: "You are a helpful assistant.",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Explain B+ trees" },
      ],
      profile: "rag",
      thinkingEnabled: false,
      reasoningEffort: "high",
      runTool: async () => ({
        status: "succeeded",
        summary: {
          hits: [
            {
              file: "第1章-绪论.pptx",
              fileId: "file-1",
              snippet: "B+ tree snippet",
              score: 3,
            },
          ],
        },
      }),
      emit: (event) => events.push(event),
    });

    expect(result.finalMessages.at(-1)?.role).toBe("assistant");
    expect(result.finalMessages.at(-1)?.content).toBe("B+ trees are balanced search trees.");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].title).toBe("第1章-绪论.pptx");
    expect(result.stopReason).toBeNull();
  });

  it("stops when the model returns no tool calls", async () => {
    vi.mocked(deepseek.completeChat).mockResolvedValueOnce({
      content: "Plain answer without tools.",
      usage: null,
    });

    const result = await runContinuationLoop({
      apiKey: "key",
      model: "deepseek-v4-pro",
      systemPrompt: "You are a helpful assistant.",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ],
      profile: "simple",
      thinkingEnabled: false,
      reasoningEffort: "high",
      runTool: async () => ({ status: "succeeded", summary: {} }),
      emit: () => {},
    });

    expect(result.finalMessages.at(-1)?.content).toBe("Plain answer without tools.");
    expect(result.stopReason).toBeNull();
  });

  it("stops at the profile round limit", async () => {
    vi.mocked(deepseek.completeChat).mockResolvedValue({
      content: "```json\n{\"tool_calls\":[{\"name\":\"project_rag.search\",\"input\":{}}]}\n```",
      usage: null,
    });

    const result = await runContinuationLoop({
      apiKey: "key",
      model: "deepseek-v4-pro",
      systemPrompt: "You are a helpful assistant.",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Keep searching" },
      ],
      profile: "simple",
      thinkingEnabled: false,
      reasoningEffort: "high",
      runTool: async () => ({
        status: "succeeded",
        summary: { hits: [] },
      }),
      emit: () => {},
    });

    expect(result.stopReason).toBe("round_limit");
  });
});
