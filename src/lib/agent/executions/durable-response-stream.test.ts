import { describe, expect, it, vi } from "vitest";

import { createDurableReplayResponse, encodeChatReplayEvent } from "./durable-response-stream";
import type { AgentExecutionRecord } from "./agent-execution-store";
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
      event(10, "run_failed", {
        failureCode: "provider_unavailable",
        message: "服务暂时不可用，请稍后重试",
      })
    );

    expect(encoded).toContain("event: execution_error\n");
    expect(encoded).toContain('"status":"failed"');
    expect(encoded).toContain('"failureCode":"provider_unavailable"');
    expect(encoded).toContain('"message":"服务暂时不可用，请稍后重试"');
    expect(encoded).not.toContain("[DONE]");
  });

  it("propagates the run failure message when the event carries one", () => {
    const encoded = encodeChatReplayEvent(
      event(11, "run_failed", {
        failureCode: "no_readable_files",
        message: "当前项目没有可读取的已解析资料，请先上传资料并等待解析完成。",
      })
    );

    expect(encoded).toContain('"failureCode":"no_readable_files"');
    expect(encoded).toContain(
      '"message":"当前项目没有可读取的已解析资料，请先上传资料并等待解析完成。"'
    );
  });

  it("omits the message field when the run failure has none", () => {
    const encoded = encodeChatReplayEvent(
      event(12, "run_cancelled", { failureCode: "execution_cancelled" })
    );

    expect(encoded).toContain('"status":"cancelled"');
    expect(encoded).toContain('"failureCode":"execution_cancelled"');
    expect(encoded).not.toContain('"message"');
  });
});

describe("durable response capacity", () => {
  it("does not page past queued events for a slow reader and stops on cancel", async () => {
    const execution = {
      id: "run-1", userId: "u", conversationId: "c", checkpoint: null,
      status: "completed", lastEventSequence: 102,
    } as AgentExecutionRecord;
    const page = vi.fn(async ({ afterSequence }: { afterSequence: number }) => ({
      status: execution.status,
      lastEventSequence: execution.lastEventSequence,
      events: Array.from({ length: Math.min(100, 102 - afterSequence) }, (_, index) => {
        const sequence = afterSequence + index + 1;
        return {
          id: String(sequence), executionId: execution.id, sequence, key: String(sequence),
          type: sequence === 102 ? "run_completed" : "assistant_text",
          payload: { text: String(sequence) }, createdAt: new Date(0),
        };
      }),
    }));
    const response = createDurableReplayResponse({
      store: { getReplayPage: page, getOwnedExecution: vi.fn(), listEventsAfter: vi.fn() },
      execution, userId: "u", format: "chat",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(page).toHaveBeenCalledTimes(1);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("id: 1\n");
    await reader.cancel();
    expect(page).toHaveBeenCalledTimes(1);
  });
});
