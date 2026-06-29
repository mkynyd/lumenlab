import { describe, expect, it, vi } from "vitest";
import { MiniMaxAdapter } from "./minimax-adapter";
import * as minimax from "@/lib/chat/minimax-chat";

vi.mock("@/lib/chat/minimax-chat", async (importOriginal) => {
  const original = await importOriginal<typeof minimax>();
  return {
    ...original,
    streamMiniMaxChat: vi.fn(),
  };
});

describe("MiniMaxAdapter", () => {
  it("forwards messages and attachments and exposes a no-op getToolCalls", async () => {
    vi.mocked(minimax.streamMiniMaxChat).mockResolvedValue({
      stream: new ReadableStream(),
      getUsage: () => ({
        prompt_tokens: 8,
        completion_tokens: 4,
        total_tokens: 12,
      }),
    });

    const attachment = {
      name: "chart.png",
      mimeType: "image/png",
      size: 1024,
      data: Buffer.from("image"),
    };

    const adapter = new MiniMaxAdapter("sk-test");
    const result = await adapter.stream({
      model: "minimax-m3",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "describe image" },
      ],
      thinkingEnabled: false,
      reasoningEffort: "high",
      attachments: [attachment],
    });

    expect(minimax.streamMiniMaxChat).toHaveBeenCalledWith("sk-test", {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "describe image" },
      ],
      attachments: [attachment],
      thinking: false,
      maxTokens: 8192,
    });
    expect(result.getToolCalls()).toEqual([]);
    expect(result.getUsage()?.total_tokens).toBe(12);
  });
});
