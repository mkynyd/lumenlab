import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  selectCompressibleMessages,
  compressHistory,
  buildCompressedMessages,
} from "./compression";

vi.mock("@/lib/deepseek", () => ({
  completeChat: vi.fn(),
}));

import { completeChat } from "@/lib/deepseek";
import type { DeepSeekMessage } from "@/lib/deepseek";

const mockedCompleteChat = vi.mocked(completeChat);
beforeEach(() => vi.clearAllMocks());

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
    it("serializes old tool blocks for summaries and preserves recent native continuations", async () => {
      const old: DeepSeekMessage = { role: "assistant", content: [
        { type: "tool_use", id: "old-call", name: "artifact_save", input: { title: "思想汇报" } },
      ] };
      const recent: DeepSeekMessage = { role: "user", content: [
        { type: "tool_result", tool_use_id: "recent-call", content: '{"id":"artifact-1"}' },
      ] };
      const messages = [old, { role: "user", content: "继续" }, recent];
      mockedCompleteChat.mockResolvedValueOnce({ content: "摘要", usage: null });
      await compressHistory({ apiKey: "key", messages, protectedWindow: 1 });
      const prompt = mockedCompleteChat.mock.lastCall?.[1].messages[1].content;
      expect(prompt).toContain(JSON.stringify(old.content));
      expect(prompt).not.toContain("[object Object]");
      expect(buildCompressedMessages(messages, "摘要", 1).at(-1)).toBe(recent);
    });

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
          model: "deepseek-flash",
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
    it("drops compressed old dialogue so the prompt never grows", () => {
      const messages = [
        { role: "system", content: "sys" },
        ...Array.from({ length: 20 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: "msg-" + i,
        })),
      ];
      const result = buildCompressedMessages(messages, "summary", 6);
      // system 1 + 摘要 1 + 受保护 12 轮对话
      expect(result).toHaveLength(1 + 1 + 12);
      expect(result[0]).toEqual({ role: "system", content: "sys" });
      expect(result[1].role).toBe("system");
      expect(result[1].content).toContain("summary");
      // 旧消息被丢弃：最早的可压缩消息 msg-0 不再出现
      expect(result.map((m) => m.content)).not.toContain("msg-0");
      // 最近对话保留
      expect(result.map((m) => m.content)).toContain("msg-19");
    });
  });
});
