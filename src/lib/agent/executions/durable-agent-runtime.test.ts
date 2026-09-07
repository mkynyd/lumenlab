import { describe, expect, it, vi } from "vitest";

import type { AgentRun, AgentRunInput } from "@/lib/agent/contracts";
import type {
  AgentCheckpoint,
  AgentExecutionRecord,
} from "./agent-execution-store";
import {
  buildInitialAgentCheckpoint,
  createDurableAgentExecutionHandler,
  upgradeAgentCheckpoint,
} from "./durable-agent-runtime";

function checkpoint(): Extract<AgentCheckpoint, { version: 1 }> {
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

function execution(
  currentCheckpoint: AgentCheckpoint = checkpoint()
): AgentExecutionRecord {
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

const loadToolSnapshot = vi.fn(async () => ({
  callId: "provider-call-1",
  toolExecutionId: "tool-execution-1",
  toolId: "artifact.save",
  arguments: { title: "笔记" },
}));

function run(
  events: AgentRun["events"],
  status: "completed" | "awaiting_approval" | "cancelled",
  usage = {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
  }
): AgentRun {
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
      usage,
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
    const handler = createDurableAgentExecutionHandler({
      run: runMock,
      recordUsage: vi.fn(),
    });
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
    expect(saved[saved.length - 1].output?.text).toBe("Kirchhoff law");
    expect(appended).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "assistant_text:a1:0",
          payload: { text: "Kirchhoff law" },
        }),
        expect.objectContaining({ key: "assistant_committed" }),
      ])
    );
    expect(result).toMatchObject({ kind: "completed" });
  });

  it("flushes large text output as multiple live segments during the run", async () => {
    const bigDelta = "x".repeat(500);
    const runMock = vi.fn(async () =>
      run(
        (async function* () {
          yield { type: "text_delta" as const, text: bigDelta };
          yield { type: "text_delta" as const, text: bigDelta };
          yield { type: "reasoning_delta" as const, text: "思考片段" };
        })(),
        "completed"
      )
    );
    const appended: Array<{ key: string; type: string; payload?: unknown }> = [];
    const result = await createDurableAgentExecutionHandler({
      run: runMock,
      recordUsage: vi.fn(),
      loadToolSnapshot,
    })({
      execution: execution(),
      signal: new AbortController().signal,
      saveCheckpoint: vi.fn(),
      appendEvent: async (value) => {
        appended.push(value);
      },
    });

    const textSegments = appended.filter((item) =>
      item.key.startsWith("assistant_text:")
    );
    // 两个 500 字符 delta：第一次达到阈值实时写入一段，尾部强制写入一段
    expect(textSegments.map((item) => item.key)).toEqual([
      "assistant_text:a1:0",
      "assistant_text:a1:1",
    ]);
    expect(
      textSegments.map(
        (item) => (item.payload as { text: string }).text
      ).join("")
    ).toBe(bigDelta + bigDelta);
    expect(
      appended.some((item) => item.key === "assistant_reasoning:a1:0")
    ).toBe(true);
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
    const result = await createDurableAgentExecutionHandler({
      run: runMock,
      recordUsage: vi.fn(),
      loadToolSnapshot,
    })({
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
    const result = await createDurableAgentExecutionHandler({
      run: runMock,
      recordUsage: vi.fn(),
      loadToolSnapshot,
    })({
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
        version: 2,
        pendingToolCall: {
          callId: "provider-call-1",
          toolExecutionId: "tool-execution-1",
          toolId: "artifact.save",
        },
        items: expect.arrayContaining([
          expect.objectContaining({
            type: "function_call",
            callId: "provider-call-1",
            name: "artifact.save",
            arguments: { title: "笔记" },
          }),
        ]),
      },
    });
    const serialized = JSON.stringify(appended);
    expect(serialized).not.toContain("must-not-persist");
    expect(serialized).not.toContain('"token"');
  });

  it("carries approval-round usage into the final durable usage record", async () => {
    const waitingRun = vi.fn(async () =>
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
        })(),
        "awaiting_approval"
      )
    );
    const waiting = await createDurableAgentExecutionHandler({
      run: waitingRun,
      recordUsage: vi.fn(),
      loadToolSnapshot,
    })({
      execution: execution(),
      signal: new AbortController().signal,
      saveCheckpoint: vi.fn(),
      appendEvent: vi.fn(),
    });
    expect(waiting).toMatchObject({
      kind: "waiting_approval",
      checkpoint: {
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      },
    });
    if (waiting.kind !== "waiting_approval") {
      throw new Error("expected waiting approval checkpoint");
    }

    const recordUsage = vi.fn().mockResolvedValue({ id: "usage-1" });
    const saved: AgentCheckpoint[] = [];
    const completed = await createDurableAgentExecutionHandler({
      loadApprovedToolOutcome: vi.fn(async () => null),
      run: vi.fn(async () =>
        run(
          (async function* () {
            yield { type: "text_delta" as const, text: "Saved" };
          })(),
          "completed",
          {
            promptTokens: 20,
            completionTokens: 7,
            totalTokens: 27,
          }
        )
      ),
      recordUsage,
    })({
      execution: execution(waiting.checkpoint),
      signal: new AbortController().signal,
      saveCheckpoint: async (value) => {
        saved.push(value);
      },
      appendEvent: vi.fn(),
    });

    expect(completed).toMatchObject({ kind: "completed" });
    expect(saved[saved.length - 1].output?.usage).toEqual({
      promptTokens: 30,
      completionTokens: 12,
      totalTokens: 42,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 30,
    });
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "message-assistant",
        model: "deepseek-v4-flash-vision-exp",
        inputCacheMissTokens: 30,
        outputTokens: 12,
        totalTokens: 42,
      })
    );
  });

  it("treats a replayed durable usage unique conflict as already recorded", async () => {
    const current: AgentCheckpoint = {
      ...checkpoint(),
      output: {
        text: "stable answer",
        reasoning: "",
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      },
    };
    const recordUsage = vi.fn().mockRejectedValue({ code: "P2002" });
    const result = await createDurableAgentExecutionHandler({
      run: vi.fn(),
      recordUsage,
    })({
      execution: execution(current),
      signal: new AbortController().signal,
      saveCheckpoint: vi.fn(),
      appendEvent: vi.fn(),
    });

    expect(result).toEqual({ kind: "completed", checkpoint: current });
    expect(recordUsage).toHaveBeenCalledOnce();
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
      version: 2,
      model: { provider: "minimax", name: "minimax-m3" },
      rag: { selectedFileIds: ["file-1"] },
      request: { message: "Start" },
      items: [
        {
          type: "message",
          role: "user",
          content: [{ type: "text", text: "Start" }],
        },
      ],
    });
    expect(JSON.stringify(initial)).not.toContain("attachments");
  });

  it("upgrades a v1 checkpoint and its legacy model before a new round", () => {
    const upgraded = upgradeAgentCheckpoint(checkpoint());
    expect(upgraded).toMatchObject({
      version: 2,
      model: {
        provider: "deepseek",
        name: "deepseek-v4-flash-vision-exp",
      },
      request: { model: "deepseek-v4-flash-vision-exp" },
      items: [
        {
          type: "message",
          role: "user",
          content: [{ type: "text", text: "Explain Kirchhoff's law" }],
        },
      ],
    });
  });

  it("maps new active models to providers through the catalog", () => {
    const cases = [
      ["deepseek-v4-flash-vision-exp", "deepseek"],
      ["minimax-m3", "minimax"],
      ["qwen3.8-flash", "bailian"],
    ] as const;
    for (const [requestedModel, provider] of cases) {
      const initial = buildInitialAgentCheckpoint({
        user: { id: "user-1" },
        conversation: {},
        prompt: { message: "Start", attachments: [] },
        model: {
          requestedModel,
          thinkingEnabled: true,
          reasoningEffort: "high",
        },
        capabilities: {
          webSearchActive: false,
          skillOff: false,
          selectedFileIds: [],
          isQuickTask: false,
        },
        signal: new AbortController().signal,
      });
      expect(initial.model).toEqual({ provider, name: requestedModel });
      expect(initial.request?.model).toBe(requestedModel);
    }
  });
  it("injects the approved tool result when resuming after approval", async () => {
    const resumed = {
      ...checkpoint(),
      pendingToolCall: {
        id: "tool-execution-1",
        toolId: "artifact.save",
        arguments: {},
      },
    };
    const captured = { value: null as AgentRunInput | null };
    const runMock = vi.fn(async (runInput: AgentRunInput) => {
      captured.value = runInput;
      return run(
        (async function* () {
          yield { type: "text_delta" as const, text: "Saved" };
        })(),
        "completed"
      );
    });
    const loadOutcome = vi.fn(async () => ({
      status: "succeeded" as const,
      resultSummary: { id: "artifact-1", title: "笔记" },
      errorSummary: null,
    }));

    const result = await createDurableAgentExecutionHandler({
      run: runMock,
      recordUsage: vi.fn(),
      loadApprovedToolOutcome: loadOutcome,
      loadToolSnapshot,
    })({
      execution: execution(resumed),
      signal: new AbortController().signal,
      saveCheckpoint: vi.fn(),
      appendEvent: vi.fn(),
    });

    expect(result.kind).toBe("completed");
    expect(loadOutcome).toHaveBeenCalledWith("tool-execution-1");
    expect(captured.value?.prompt.message).toBe("Explain Kirchhoff's law");
    expect(JSON.stringify(captured.value?.durable?.continuationMessages)).toContain(
      "artifact-1"
    );
    expect(JSON.stringify(captured.value?.durable?.continuationMessages)).toContain(
      "provider-call-1"
    );
    expect(captured.value?.durable?.completedToolCalls).toEqual([
      { toolId: "artifact.save", arguments: { title: "笔记" } },
    ]);
  });
  it("writes a terminal placeholder when a durable run is cancelled", async () => {
    const result = await createDurableAgentExecutionHandler({
      run: vi.fn(async () =>
        run(
          (async function* () {
            yield { type: "text_delta" as const, text: "partial" };
          })(),
          "cancelled"
        )
      ),
      recordUsage: vi.fn(),
    })({
      execution: execution(),
      signal: new AbortController().signal,
      saveCheckpoint: vi.fn(),
      appendEvent: vi.fn(),
    });

    expect(result.kind).toBe("cancelled");
  });

  it("checkpoints partial content and observed usage when a stream is interrupted", async () => {
    const saved: AgentCheckpoint[] = [];
    const handler = createDurableAgentExecutionHandler({
      run: vi.fn(async () =>
        run(
          (async function* () {
            yield { type: "text_delta" as const, text: "partial answer" };
            yield {
              type: "usage" as const,
              usage: {
                promptTokens: 8,
                completionTokens: 2,
                totalTokens: 10,
              },
            };
            throw new Error("stream interrupted");
          })(),
          "completed"
        )
      ),
      recordUsage: vi.fn(),
    });

    await expect(
      handler({
        execution: execution(),
        signal: new AbortController().signal,
        saveCheckpoint: async (value) => {
          saved.push(value);
        },
        appendEvent: vi.fn(),
      })
    ).rejects.toThrow("stream interrupted");
    expect(saved[saved.length - 1]).toMatchObject({
      version: 2,
      usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
      partialOutput: {
        text: "partial answer",
        reasoning: "",
        usage: { promptTokens: 8, completionTokens: 2, totalTokens: 10 },
      },
    });
  });
});
