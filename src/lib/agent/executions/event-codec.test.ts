import { describe, expect, it } from "vitest";

import {
  decodeDurableAgentEvent,
  encodeDurableAgentEvent,
} from "@/lib/agent/executions/event-codec";

describe("durable agent event codec", () => {
  it("round-trips a versioned run-level event", () => {
    const event = {
      schemaVersion: 1 as const,
      agentExecutionId: "run-1",
      sequence: 7,
      type: "assistant.delta",
      payload: { text: "hello" },
    };

    expect(decodeDurableAgentEvent(encodeDurableAgentEvent(event))).toEqual(event);
  });

  it("rejects tool execution IDs masquerading as a run envelope", () => {
    expect(() =>
      decodeDurableAgentEvent(
        JSON.stringify({
          schemaVersion: 1,
          executionId: "tool-execution-1",
          sequence: 1,
          type: "tool.pending",
          payload: null,
        })
      )
    ).toThrow();
  });

  it("rejects zero and negative sequence numbers", () => {
    expect(() =>
      decodeDurableAgentEvent(
        JSON.stringify({
          schemaVersion: 1,
          agentExecutionId: "run-1",
          sequence: 0,
          type: "run.queued",
          payload: null,
        })
      )
    ).toThrow();
  });

  it("rejects secret-bearing and non-JSON payloads before serialization", () => {
    expect(() =>
      encodeDurableAgentEvent({
        schemaVersion: 1,
        agentExecutionId: "run-1",
        sequence: 1,
        type: "approval.required",
        payload: { approvalToken: "raw-secret" },
      })
    ).toThrow();
    expect(() =>
      encodeDurableAgentEvent({
        schemaVersion: 1,
        agentExecutionId: "run-1",
        sequence: 1,
        type: "run.progress",
        payload: { callback: () => undefined } as never,
      })
    ).toThrow();
  });

  it("rejects cycles and oversized payloads", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() =>
      encodeDurableAgentEvent({
        schemaVersion: 1,
        agentExecutionId: "run-1",
        sequence: 1,
        type: "run.progress",
        payload: cyclic as never,
      })
    ).toThrow();
    expect(() =>
      encodeDurableAgentEvent({
        schemaVersion: 1,
        agentExecutionId: "run-1",
        sequence: 1,
        type: "assistant.snapshot",
        payload: { text: "x".repeat(70_000) },
      })
    ).toThrow();
  });
});
