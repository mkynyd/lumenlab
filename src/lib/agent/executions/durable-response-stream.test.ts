import { describe, expect, it } from "vitest";

import { encodeChatReplayEvent } from "./durable-response-stream";
import type { DurableAgentEvent } from "./event-codec";

function event(
  sequence: number,
  type: string,
  payload: DurableAgentEvent["payload"]
): DurableAgentEvent {
  return {
    schemaVersion: 1,
    agentExecutionId: "run-1",
    sequence,
    type,
    payload,
  };
}

describe("durable chat replay encoding", () => {
  it("uses the durable database sequence as the SSE id for text", () => {
    const encoded = encodeChatReplayEvent(
      event(7, "assistant_text", { text: "继续回答" })
    );

    expect(encoded).toContain("id: 7\n");
    expect(encoded).toContain('"content":"继续回答"');
  });

  it("rehydrates a tokenless approval event without persisting its secret", () => {
    const eventJson = JSON.stringify({
      type: "approval_required",
      executionId: "tool-1",
      preview: {
        toolId: "artifact.save",
        toolName: "保存成果",
        summary: "保存学习成果",
        affectedResources: [],
        sendsToExternal: false,
        isReversible: true,
        dataTypes: [],
      },
      expiresAt: 1_785_000_000_000,
      canApproveSession: true,
    });
    const encoded = encodeChatReplayEvent(
      event(8, "agent_event", { eventJson })
    );

    expect(encoded).toContain("id: 8\n");
    expect(encoded).toContain("event: agent\n");
    expect(encoded).toContain('"token":""');
    expect(encoded).not.toContain("Bearer");
  });

  it("closes successful chat replay with the legacy DONE marker", () => {
    expect(encodeChatReplayEvent(event(9, "run_completed", {}))).toBe(
      "id: 9\ndata: [DONE]\n\n"
    );
  });

  it("surfaces a structured terminal error instead of a false DONE", () => {
    const encoded = encodeChatReplayEvent(
      event(10, "run_failed", { failureCode: "provider_unavailable" })
    );

    expect(encoded).toContain("event: execution_error\n");
    expect(encoded).toContain('"status":"failed"');
    expect(encoded).toContain('"failureCode":"provider_unavailable"');
    expect(encoded).not.toContain("[DONE]");
  });
});
