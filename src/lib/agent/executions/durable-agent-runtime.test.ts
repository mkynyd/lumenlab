import { describe, expect, it, vi } from "vitest";

import type { AgentRun } from "@/lib/agent/contracts";
import type {
  AgentCheckpoint,
  AgentExecutionRecord,
} from "./agent-execution-store";
import {
  buildInitialAgentCheckpoint,
  createDurableAgentExecutionHandler,
} from "./durable-agent-runtime";

function checkpoint(): AgentCheckpoint {
  return {
    version: 1,
    messages: [{ role: "user", content: "Explain Kirchhoff's law" }],
    round: 0,
    model: { provider: "deepseek", name: "deepseek-v4-pro" },
    skill: { id: null, version: null },
    rag: { sourceIds: [], selectedFileIds: [] },
    allowedToolIds: [],
    request: {
      message: "Explain Kirchhoff's law",
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "high",
      webSearchActive: false,
      skillOff: false,
      isQuickTask: false,
    },
  };
}

function execution(currentCheckpoint = checkpoint()): AgentExecutionRecord {
  const now = new Date("2026-07-31T00:00:00.000Z");
  return {
    id: "run-1",
    userId: "user-1",
    clientRunKey: "client-1",
    requestHash: "sha256:request",
    userMessageId: "message-user",
    assistantMessageId: "message-assistant",
    conversationId: "conversation-1",
    projectId: null,
    status: "running",
    checkpoint: currentCheckpoint,
    waitingToolExecutionId: null,
    scheduledAt: now,
    leaseOwner: "worker-1",
    leaseExpiresAt: new Date("2026-07-31T00:01:00.000Z"),
    attempt: 1,
    lastEventSequence: 2,
    failure: null,
    createdAt: now,
    updatedAt: now,
  };
}

function run(events: AgentRun["events"], status: "completed" | "awaiting_approval"): AgentRun {
  return {
    metadata: {
      conversationId: "conversation-1",
      messageId: "message-assistant",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      runtimeMode: "new",
      runtimeVersion: "1",
      toolProtocol: "native",
      agentExecutionId: "run-1",
    },
    events,
    completion: Promise.resolve({
      status,
      conversationId: "conversation-1",
      messageId: "message-assistant",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      sources: [],
    }),
  };
}

describe("durable Agent runtime bridge", () => {
  it("reconstructs the stable message pair and checkpoints output before replay", async () => {
    const runMock = vi.fn(async () =>
      run(
        (async function* () {
          yield { type: "text_delta" as const, text: "Kirchhoff" };
          yield { type: "text_delta" as const, text: " law" };
          yield {
            type: "completed" as const,
            conversationId: "conversation-1",
            messageId: "message-assistant",
          };
        })(),
        "completed"
      )
    );
    const saved: AgentCheckpoint[] = [];
    const appended: Array<{ key: string; type: string; payload?: unknown }> = [];
    const handler = createDurableAgentExecutionHandler({ run: runMock });
    const result = await handler({
      execution: execution(),
      signal: new AbortController().signal,
      saveCheckpoint: async (value) => {
        saved.push(value);
      },
      appendEvent: async (value) => {
        appended.push(value);
      },
    });

    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: { id: "conversation-1" },
        durable: {
          executionId: "run-1",
          userMessageId: "message-user",
          assistantMessageId: "message-assistant",
        },
      })
    );
    expect(saved[0].output?.text).toBe("Kirchhoff law");
    expect(appended).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "assistant_text:0",
          payload: { text: "Kirchhoff law" },
        }),
        expect.objectContaining({ key: "assistant_committed" }),
      ])
    );
    expect(result).toMatchObject({ kind: "completed" });
  });

  it("replays a checkpointed output without calling the provider again", async () => {
    const current = {
      ...checkpoint(),
      output: {
        text: "stable answer",
        reasoning: "",
        usage: null,
      },
    };
    const runMock = vi.fn();
    const appended: Array<{ key: string }> = [];
    const result = await createDurableAgentExecutionHandler({ run: runMock })({
      execution: execution(current),
      signal: new AbortController().signal,
      saveCheckpoint: vi.fn(),
      appendEvent: async (value) => {
        appended.push(value);
      },
    });

    expect(runMock).not.toHaveBeenCalled();
    expect(appended.map((item) => item.key)).toEqual([
      "assistant_text:0",
      "assistant_committed",
    ]);
    expect(result).toEqual({ kind: "completed", checkpoint: current });
  });

  it("persists tokenless approval metadata and releases the worker lease", async () => {
    const runMock = vi.fn(async () =>
      run(
        (async function* () {
          yield {
            type: "approval_required" as const,
            executionId: "tool-execution-1",
            preview: {
              toolId: "artifact.save",
              toolName: "Save artifact",
              summary: "Save a study note",
              affectedResources: [],
              sendsToExternal: false,
              isReversible: true,
              dataTypes: ["markdown"],
            },
            token: "must-not-persist",
            expiresAt: 1_785_456_000_000,
            canApproveSession: true,
          };
          yield {
            type: "completed" as const,
            conversationId: "conversation-1",
            messageId: "message-assistant",
          };
        })(),
        "awaiting_approval"
      )
    );
    const appended: Array<{ payload?: unknown }> = [];
    const result = await createDurableAgentExecutionHandler({ run: runMock })({
      execution: execution(),
      signal: new AbortController().signal,
      saveCheckpoint: vi.fn(),
      appendEvent: async (value) => {
        appended.push(value);
      },
    });

    expect(result).toMatchObject({
      kind: "waiting_approval",
      toolExecutionId: "tool-execution-1",
      checkpoint: {
        pendingToolCall: {
          id: "tool-execution-1",
          toolId: "artifact.save",
        },
      },
    });
    const serialized = JSON.stringify(appended);
    expect(serialized).not.toContain("must-not-persist");
    expect(serialized).not.toContain('"token"');
  });

  it("builds a provider-neutral request checkpoint without attachments", () => {
    const initial = buildInitialAgentCheckpoint({
      user: { id: "user-1" },
      conversation: { projectId: "project-1" },
      prompt: {
        message: "Start",
        attachments: [],
      },
      model: {
        requestedModel: "minimax-m3",
        thinkingEnabled: true,
        reasoningEffort: "high",
      },
      capabilities: {
        webSearchActive: false,
        skillOff: false,
        selectedFileIds: ["file-1"],
        isQuickTask: false,
      },
      signal: new AbortController().signal,
    });

    expect(initial).toMatchObject({
      model: { provider: "minimax", name: "minimax-m3" },
      rag: { selectedFileIds: ["file-1"] },
      request: { message: "Start" },
    });
    expect(JSON.stringify(initial)).not.toContain("attachments");
  });
});
