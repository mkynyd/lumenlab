import { describe, expect, it } from "vitest";
import {
  PENDING_ASSISTANT_RECOVERY_WINDOW_MS,
  toChatMessages,
} from "./project-conversation-state";

const nowMs = Date.parse("2026-06-19T01:00:00.000Z");

describe("project conversation state", () => {
  it("marks recent empty assistant placeholders as background streaming", () => {
    const messages = toChatMessages(
      [
        {
          id: "user-1",
          role: "user",
          content: "生成 Mermaid 逻辑图",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          reasoningContent: null,
          tokenCount: null,
          createdAt: new Date(nowMs - 30_000).toISOString(),
        },
      ],
      nowMs
    );

    expect(messages[1]).toMatchObject({
      isStreaming: true,
      streamingSource: "background",
    });
  });

  it("does not keep polling stale empty assistant placeholders", () => {
    const messages = toChatMessages(
      [
        {
          id: "user-1",
          role: "user",
          content: "生成 Mermaid 逻辑图",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          reasoningContent: null,
          tokenCount: null,
          createdAt: new Date(
            nowMs - PENDING_ASSISTANT_RECOVERY_WINDOW_MS - 1
          ).toISOString(),
        },
      ],
      nowMs
    );

    expect(messages.some((message) => message.isStreaming)).toBe(false);
  });

  it("does not infer pending generation from user-only conversations", () => {
    const messages = toChatMessages(
      [
        {
          id: "user-1",
          role: "user",
          content: "生成 Mermaid 逻辑图",
          createdAt: new Date(nowMs - 30_000).toISOString(),
        },
      ],
      nowMs
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].isStreaming).toBeUndefined();
  });

  it("preserves a hydrated assistant process when a conversation is loaded", () => {
    const process = {
      status: "completed" as const,
      startedAt: nowMs - 2_000,
      completedAt: nowMs,
      tools: [{
        executionId: "search-1",
        toolId: "web.search",
        label: "搜索公开资料",
        status: "completed" as const,
        progress: 100,
        sources: [{ type: "web" as const, title: "来源", url: "https://example.com" }],
      }],
    };

    const [message] = toChatMessages([{
      id: "assistant-1",
      role: "assistant",
      content: "完成",
      process,
      createdAt: new Date(nowMs).toISOString(),
    }], nowMs);

    expect(message.process).toEqual(process);
    expect(message.isStreaming).toBeUndefined();
  });
});
