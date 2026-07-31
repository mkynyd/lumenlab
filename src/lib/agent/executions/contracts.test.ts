import { describe, expect, it } from "vitest";

import {
  AGENT_EXECUTION_ERROR_CODES,
  durableApprovalEventPayloadSchema,
  toPublicAgentExecution,
  type PrivateAgentExecutionDto,
} from "@/lib/agent/executions/contracts";

describe("durable execution contracts", () => {
  it("freezes idempotency, ownership, and state-conflict errors", () => {
    expect(AGENT_EXECUTION_ERROR_CODES).toEqual([
      "execution_not_found",
      "idempotency_key_reused",
      "conversation_execution_in_progress",
      "execution_not_retryable",
      "execution_lease_lost",
    ]);
  });

  it("does not expose checkpoint, lease, or raw failure details", () => {
    const execution: PrivateAgentExecutionDto = {
      id: "run-1",
      conversationId: "conversation-1",
      projectId: "project-1",
      status: "running",
      lastEventSequence: 4,
      attempt: 1,
      scheduledAt: "2026-07-31T00:00:00.000Z",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:01:00.000Z",
      failureCode: null,
      checkpoint: { messages: ["private"] },
      leaseOwner: "worker-secret",
      leaseExpiresAt: "2026-07-31T00:02:00.000Z",
      requestHash: "sha256:private",
    };

    expect(toPublicAgentExecution(execution)).toEqual({
      id: "run-1",
      conversationId: "conversation-1",
      projectId: "project-1",
      status: "running",
      lastEventSequence: 4,
      attempt: 1,
      scheduledAt: "2026-07-31T00:00:00.000Z",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:01:00.000Z",
      failureCode: null,
    });
  });

  it("allows replayable approval metadata but rejects raw approval tokens", () => {
    expect(
      durableApprovalEventPayloadSchema.parse({
        toolExecutionId: "tool-execution-1",
        toolId: "artifact.save",
        preview: { title: "复习笔记" },
        expiresAt: "2026-07-31T00:05:00.000Z",
      })
    ).toMatchObject({ toolExecutionId: "tool-execution-1" });

    expect(() =>
      durableApprovalEventPayloadSchema.parse({
        toolExecutionId: "tool-execution-1",
        toolId: "artifact.save",
        preview: {},
        expiresAt: "2026-07-31T00:05:00.000Z",
        token: "raw-token",
      })
    ).toThrow();
  });
});
