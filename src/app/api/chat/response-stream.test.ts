import { describe, expect, it } from "vitest";
import type { AgentRun } from "@/lib/agent/contracts";
import { createChatResponse } from "./response-stream";

async function* events(): AgentRun["events"] {
  yield {
    type: "model_adapter_selected",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    fallback: "native_tools",
  };
  yield { type: "model_started", provider: "deepseek", model: "deepseek-v4-pro" };
  yield { type: "reasoning_delta", text: "思考" };
  yield { type: "text_delta", text: "回答" };
  yield {
    type: "usage",
    usage: {
      promptTokens: 2,
      completionTokens: 3,
      totalTokens: 5,
      promptCacheHitTokens: 1,
      promptCacheMissTokens: 1,
    },
  };
  yield { type: "completed", conversationId: "conv-1", messageId: "msg-1" };
}

describe("createChatResponse", () => {
  it("preserves chat headers and translates runtime events to the existing SSE protocol", async () => {
    const response = createChatResponse({
      metadata: {
        conversationId: "conv-1",
        messageId: "msg-1",
        provider: "deepseek",
        model: "deepseek-v4-pro",
        runtimeMode: "new",
        runtimeVersion: "1",
        toolProtocol: "native+xml_dsml",
      },
      events: events(),
      completion: Promise.resolve({
        status: "completed",
        conversationId: "conv-1",
        messageId: "msg-1",
        provider: "deepseek",
        model: "deepseek-v4-pro",
        usage: null,
        sources: [],
      }),
    });

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("X-Conversation-Id")).toBe("conv-1");
    expect(response.headers.get("X-Message-Id")).toBe("msg-1");
    expect(response.headers.get("X-Model-Provider")).toBe("deepseek");
    expect(response.headers.get("X-Agent-Orchestrator")).toBe("enabled");
    expect(response.headers.get("X-Agent-Runtime-Version")).toBe("1");
    expect(response.headers.get("X-Agent-Tool-Protocol")).toBe(
      "native+xml_dsml"
    );

    const body = await response.text();
    expect(body).toContain("event: agent");
    expect(body).toContain('"type":"model_adapter_selected"');
    expect(body).not.toContain('"type":"model_started"');
    expect(body).toContain('"reasoning_content":"思考"');
    expect(body).toContain('"content":"回答"');
    expect(body).toContain('"prompt_tokens":2');
    expect(body).toContain("data: [DONE]");
  });
});
