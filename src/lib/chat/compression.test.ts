import { describe, it, expect, vi } from "vitest";
import {
  selectCompressibleMessages,
  compressHistory,
  buildCompressedMessages,
} from "./compression";

vi.mock("@/lib/deepseek", () => ({
  completeChat: vi.fn(),
}));

import { completeChat } from "@/lib/deepseek";

const mockedCompleteChat = vi.mocked(completeChat);

describe("compression", () => {
  describe("selectCompressibleMessages", () => {
    it("returns empty compressible list when dialogue is within protected window", () => {
      const messages = [
        { role: "system", content: "sys" },
        ...Array.from({ length: 6 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `msg-${i}`,
        })),
      ];
      const result = selectCompressibleMessages(messages, 6);
      expect(result.compressible).toHaveLength(0);
      expect(result.protectedMessages).toHaveLength(messages.length);
    });

    it("selects oldest user/assistant messages for compression", () => {
      const messages = [
        { role: "system", content: "sys" },
        ...Array.from({ length: 20 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `msg-${i}`,
        })),
      ];
      const result = selectCompressibleMessages(messages, 6);
      // 20 dialogue messages, protect 12, compress 8
      expect(result.compressible).toHaveLength(8);
      expect(result.protectedMessages).toHaveLength(1 + 12);
    });
  });

  describe("compressHistory", () => {
    it("returns null when nothing to compress", async () => {
      const messages = [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ];
      const result = await compressHistory({ apiKey: "key", messages });
      expect(result).toBeNull();
      expect(mockedCompleteChat).not.toHaveBeenCalled();
    });

    it("calls DeepSeek V4 Flash and returns summary", async () => {
      mockedCompleteChat.mockResolvedValueOnce({
        content: "摘要内容",
        usage: null,
      });

      const messages = [
        { role: "system", content: "sys" },
        ...Array.from({ length: 20 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `msg-${i}`,
        })),
      ];
      const result = await compressHistory({
        apiKey: "key",
        messages,
        userPrompt: "保留代码约定",
      });

      expect(result).not.toBeNull();
      expect(result?.summary).toBe("摘要内容");
      expect(result?.compressedCount).toBe(8);
      expect(mockedCompleteChat).toHaveBeenCalledWith(
        "key",
        expect.objectContaining({
          model: "deepseek-v4-flash",
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            expect.objectContaining({ role: "user" }),
          ]),
        })
      );
    });
  });

  describe("buildCompressedMessages", () => {
    it("inserts summary after system prompts", () => {
      const messages = [
        { role: "system", content: "sys" },
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ];
      const result = buildCompressedMessages(messages, "summary");
      expect(result[0]).toEqual({ role: "system", content: "sys" });
      expect(result[1].role).toBe("system");
      expect(result[1].content).toContain("summary");
      expect(result[2]).toEqual({ role: "user", content: "a" });
      expect(result[3]).toEqual({ role: "assistant", content: "b" });
    });
  });
});
