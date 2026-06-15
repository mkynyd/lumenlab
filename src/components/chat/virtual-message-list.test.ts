import { describe, expect, it } from "vitest";
import { splitStreamingMessage } from "@/components/chat/virtual-message-list";

describe("splitStreamingMessage", () => {
  it("keeps the final streaming message outside virtualization", () => {
    const messages = [
      { id: "1", role: "user" as const, content: "hello" },
      {
        id: "2",
        role: "assistant" as const,
        content: "stream",
        isStreaming: true,
      },
    ];
    expect(splitStreamingMessage(messages)).toEqual({
      completed: [messages[0]],
      streaming: messages[1],
    });
  });

  it("virtualizes all messages when the last message is complete", () => {
    const messages = [
      { id: "1", role: "assistant" as const, content: "done" },
    ];
    expect(splitStreamingMessage(messages)).toEqual({
      completed: messages,
      streaming: undefined,
    });
  });
});
