import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "./agent-loop";
import type { ProviderAdapter, ProviderRound } from "../provider-adapter";
import type { ToolMetadata } from "../types";
import type { ToolRunner } from "../tools/tool-runner";

describe("runAgentLoop", () => {
  it("suspends on approval without continuing the model or leaking fallback markup", async () => {
    const toolCall = {
      id: "parsed-project_files.delete-0",
      name: "project_files.delete",
      input: { projectId: "project-1", fileId: "file-1" },
      source: "xml_dsml" as const,
    };
    const initialRound = providerRound({
      rawContent:
        '<tool_calls><invoke name="project_files.delete"><parameter name="fileId">file-1</parameter></invoke></tool_calls>',
      toolCalls: [toolCall],
    });
    const continueRound = vi.fn();
    const provider = {
      provider: "deepseek",
      stream: vi.fn(),
      toolProtocol: () => "native+xml_dsml",
      startRound: vi.fn(),
      continueRound,
    } as unknown as ProviderAdapter;
    const runner: ToolRunner = {
      async run(_request, emit) {
        emit({
          type: "approval_required",
          executionId: "execution-1",
          preview: {
            toolId: "project_files.delete",
            toolName: "Delete file",
            summary: "Delete file-1",
            affectedResources: [],
            sendsToExternal: false,
            isReversible: false,
            dataTypes: [],
          },
          token: "approval-token",
          expiresAt: 1234,
          canApproveSession: false,
        });
        return { status: "pending_approval", executionId: "execution-1" };
      },
    };
    const events: string[] = [];

    const result = await runAgentLoop({
      provider,
      initialRound,
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools: [tool("project_files.delete")],
      messages: initialRound.requestMessages,
      context: {
        userId: "user-1",
        conversationId: "conversation-1",
        projectId: "project-1",
        sessionApprovals: new Map(),
      },
      signal: new AbortController().signal,
      toolRunner: runner,
      emit: (event) => events.push(event.type),
      audit: async () => {},
    });

    expect(result.status).toBe("awaiting_approval");
    expect(result.pendingExecutionIds).toEqual(["execution-1"]);
    expect(continueRound).not.toHaveBeenCalled();
    expect(events).toContain("approval_required");
    expect(await readText(result.finalRound.events)).not.toContain("tool_calls");
  });

  it("cancels a buffered provider round before any tool can execute", async () => {
    const abortController = new AbortController();
    const toolRunner = { run: vi.fn() } as unknown as ToolRunner;
    const continueRound = vi.fn();
    const initialRound: ProviderRound = {
      ...providerRound({
        rawContent: "",
        toolCalls: [
          {
            id: "tool-1",
            name: "project_files.delete",
            input: { fileId: "file-1" },
            source: "native",
          },
        ],
      }),
      events: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text_delta", text: "" });
          // Keep the provider open until the request signal cancels the reader.
        },
      }),
    };

    const resultPromise = runAgentLoop({
      provider: {
        provider: "deepseek",
        stream: vi.fn(),
        toolProtocol: () => "native",
        startRound: vi.fn(),
        continueRound,
      } as unknown as ProviderAdapter,
      initialRound,
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools: [tool("project_files.delete")],
      messages: initialRound.requestMessages,
      context: {
        userId: "user-1",
        conversationId: "conversation-1",
        sessionApprovals: new Map(),
      },
      signal: abortController.signal,
      toolRunner,
      emit: () => {},
      audit: async () => {},
    });

    abortController.abort();
    const result = await resultPromise;

    expect(result.status).toBe("cancelled");
    expect(result.stopReason).toBe("cancelled");
    expect(toolRunner.run).not.toHaveBeenCalled();
    expect(continueRound).not.toHaveBeenCalled();
  });

  it("deduplicates model calls against tools already attempted by the prelude", async () => {
    const initialRound = providerRound({
      rawContent: "",
      toolCalls: [
        {
          id: "native-1",
          name: "project_files.delete",
          input: { fileId: "file-1" },
          source: "native",
        },
      ],
    });
    const toolRunner = { run: vi.fn() } as unknown as ToolRunner;
    const audit = vi.fn(async () => {});

    const result = await runAgentLoop({
      provider: {
        provider: "deepseek",
        stream: vi.fn(),
        toolProtocol: () => "native",
        startRound: vi.fn(),
        continueRound: vi.fn(),
      } as unknown as ProviderAdapter,
      initialRound,
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools: [tool("project_files.delete")],
      messages: initialRound.requestMessages,
      context: {
        userId: "user-1",
        conversationId: "conversation-1",
        sessionApprovals: new Map(),
      },
      signal: new AbortController().signal,
      toolRunner,
      emit: () => {},
      audit,
      preAttemptedCalls: [
        {
          toolId: "project_files.delete",
          arguments: { fileId: "file-1" },
        },
      ],
    });

    expect(result.status).toBe("completed");
    expect(toolRunner.run).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "tool_blocked",
        payload: expect.objectContaining({ reasonCode: "DUPLICATE_CALL" }),
      })
    );
  });

  it("executes identical calls at most once within the same provider round", async () => {
    const initialRound = providerRound({
      rawContent: "",
      toolCalls: [
        {
          id: "native-1",
          name: "project_files.list",
          input: { projectId: "project-1" },
          source: "native",
        },
        {
          id: "native-2",
          name: "project_files.list",
          input: { projectId: "project-1" },
          source: "native",
        },
      ],
    });
    const run = vi.fn(async () => ({
      status: "succeeded" as const,
      executionId: "execution-1",
      summary: { files: [] },
    }));
    const audit = vi.fn(async () => {});
    const continueRound = vi.fn().mockResolvedValue(
      providerRound({ rawContent: "done", toolCalls: [] })
    );

    await runAgentLoop({
      provider: {
        provider: "deepseek",
        stream: vi.fn(),
        toolProtocol: () => "native",
        startRound: vi.fn(),
        continueRound,
      } as unknown as ProviderAdapter,
      initialRound,
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools: [tool("project_files.list")],
      messages: initialRound.requestMessages,
      context: {
        userId: "user-1",
        conversationId: "conversation-1",
        projectId: "project-1",
        sessionApprovals: new Map(),
      },
      signal: new AbortController().signal,
      toolRunner: { run },
      emit: () => {},
      audit,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(continueRound).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCalls: [expect.objectContaining({ id: "native-1" })],
      })
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "tool_blocked",
        payload: expect.objectContaining({ reasonCode: "DUPLICATE_CALL" }),
      })
    );
  });

  it("does not repeat an identical call after its first attempt fails", async () => {
    const repeatedCall = {
      id: "native-1",
      name: "project_files.list",
      input: { projectId: "project-1" },
      source: "native" as const,
    };
    const initialRound = providerRound({
      rawContent: "",
      toolCalls: [repeatedCall],
    });
    const run = vi.fn(async () => ({
      status: "failed" as const,
      executionId: "execution-1",
      code: "HANDLER_ERROR",
      error: "failed",
    }));
    const audit = vi.fn(async () => {});
    const continueRound = vi.fn().mockResolvedValue(
      providerRound({
        rawContent: "retry",
        toolCalls: [{ ...repeatedCall, id: "native-2" }],
      })
    );

    await runAgentLoop({
      provider: {
        provider: "deepseek",
        stream: vi.fn(),
        toolProtocol: () => "native",
        startRound: vi.fn(),
        continueRound,
      } as unknown as ProviderAdapter,
      initialRound,
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools: [tool("project_files.list")],
      messages: initialRound.requestMessages,
      context: {
        userId: "user-1",
        conversationId: "conversation-1",
        projectId: "project-1",
        sessionApprovals: new Map(),
      },
      signal: new AbortController().signal,
      toolRunner: { run },
      emit: () => {},
      audit,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(continueRound).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "tool_blocked",
        payload: expect.objectContaining({ reasonCode: "DUPLICATE_CALL" }),
      })
    );
  });

  it("propagates provider continuation failures to the Runtime error mapper", async () => {
    const providerError = new Error("provider unavailable");
    const initialRound = providerRound({
      rawContent: "",
      toolCalls: [
        {
          id: "native-1",
          name: "project_files.list",
          input: { projectId: "project-1" },
          source: "native",
        },
      ],
    });
    const runner: ToolRunner = {
      async run() {
        return {
          status: "succeeded",
          executionId: "execution-1",
          summary: { files: [] },
        };
      },
    };

    await expect(
      runAgentLoop({
        provider: {
          provider: "deepseek",
          stream: vi.fn(),
          toolProtocol: () => "native",
          startRound: vi.fn(),
          continueRound: vi.fn().mockRejectedValue(providerError),
        } as unknown as ProviderAdapter,
        initialRound,
        model: "deepseek-v4-pro",
        thinkingEnabled: true,
        reasoningEffort: "max",
        activeTools: [tool("project_files.list")],
        messages: initialRound.requestMessages,
        context: {
          userId: "user-1",
          conversationId: "conversation-1",
          projectId: "project-1",
          sessionApprovals: new Map(),
        },
        signal: new AbortController().signal,
        toolRunner: runner,
        emit: () => {},
        audit: async () => {},
      })
    ).rejects.toBe(providerError);
  });

  it("records only an explicitly linked retry as an automatic recovery", async () => {
    const initialRound = providerRound({
      rawContent: "",
      toolCalls: [
        {
          id: "native-failed-1",
          name: "project_files.list",
          input: { projectId: "project-1" },
          source: "native",
        },
      ],
    });
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        status: "failed" as const,
        executionId: "execution-failed-1",
        code: "TIMEOUT",
        error: "timeout",
      })
      .mockResolvedValueOnce({
        status: "succeeded" as const,
        executionId: "execution-recovery-1",
        summary: { files: [] },
      });
    const emitted: Array<{ type: string; [key: string]: unknown }> = [];
    const continueRound = vi
      .fn()
      .mockResolvedValueOnce(
        providerRound({
          rawContent: "",
          toolCalls: [
            {
              id: "native-recovery-1",
              name: "project_files.list",
              input: {
                projectId: "project-1",
                recoveryOfExecutionId: "execution-failed-1",
              },
              source: "native",
            },
          ],
        })
      )
      .mockResolvedValueOnce(providerRound({ rawContent: "完成", toolCalls: [] }));

    await runAgentLoop({
      provider: {
        provider: "deepseek",
        stream: vi.fn(),
        toolProtocol: () => "native",
        startRound: vi.fn(),
        continueRound,
      } as unknown as ProviderAdapter,
      initialRound,
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools: [tool("project_files.list")],
      messages: initialRound.requestMessages,
      context: {
        userId: "user-1",
        conversationId: "conversation-1",
        projectId: "project-1",
        sessionApprovals: new Map(),
      },
      signal: new AbortController().signal,
      toolRunner: { run },
      emit: (event) => emitted.push(event),
      audit: async () => {},
    });

    expect(run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        call: expect.objectContaining({ arguments: { projectId: "project-1" } }),
      }),
      expect.any(Function)
    );
    expect(emitted).toContainEqual({
      type: "tool_recovery_attempted",
      failedExecutionId: "execution-failed-1",
      recoveryExecutionId: "execution-recovery-1",
    });
  });

  it("publishes a validated plan event when the model updates a workflow plan", async () => {
    const initialRound = providerRound({
      rawContent: "",
      toolCalls: [
        {
          id: "native-plan-1",
          name: "plan.update",
          input: {
            steps: [
              { id: "understand", title: "明确研究问题与边界", status: "completed" },
              { id: "gather", title: "收集可核验的资料", status: "in_progress" },
            ],
            currentStepId: "gather",
          },
          source: "native",
        },
      ],
    });
    const emitted: string[] = [];

    await runAgentLoop({
      provider: {
        provider: "deepseek",
        stream: vi.fn(),
        toolProtocol: () => "native",
        startRound: vi.fn(),
        continueRound: vi.fn().mockResolvedValue(providerRound({ rawContent: "完成", toolCalls: [] })),
      } as unknown as ProviderAdapter,
      initialRound,
      model: "deepseek-v4-pro",
      thinkingEnabled: true,
      reasoningEffort: "max",
      activeTools: [tool("plan.update")],
      messages: initialRound.requestMessages,
      context: {
        userId: "user-1",
        conversationId: "conversation-1",
        sessionApprovals: new Map(),
      },
      signal: new AbortController().signal,
      toolRunner: {
        run: async () => ({
          status: "succeeded",
          executionId: "execution-plan-1",
          summary: {
            steps: [
              { id: "understand", title: "明确研究问题与边界", status: "completed" },
              { id: "gather", title: "收集可核验的资料", status: "in_progress" },
            ],
            currentStepId: "gather",
          },
        }),
      },
      emit: (event) => emitted.push(event.type),
      audit: async () => {},
    });

    expect(emitted).toContain("plan_updated");
  });
});

function providerRound(input: {
  rawContent: string;
  toolCalls: ProviderRound["getToolCalls"] extends () => infer T ? T : never;
}): ProviderRound {
  return {
    requestMessages: [
      { role: "system", content: "system" },
      { role: "user", content: "delete file" },
    ],
    events: new ReadableStream({
      start(controller) {
        if (input.rawContent) {
          controller.enqueue({ type: "text_delta", text: input.rawContent });
        }
        controller.close();
      },
    }),
    getUsage: () => null,
    getToolCalls: () => input.toolCalls,
    getRawContent: () => input.rawContent,
    getRawReasoning: () => "",
  };
}

function tool(toolId: string): ToolMetadata {
  return {
    toolId,
    name: toolId,
    description: toolId,
    inputSchema: {},
    outputSchema: {},
    riskLevel: "L3",
    isReadOnly: false,
    hasExternalSideEffect: true,
    isReversible: false,
    containsSensitiveData: false,
    requiresNetwork: false,
    defaultApprovalMode: "ask_each",
    allowedSkillIds: [],
    auditLevel: "standard",
    requiredScopes: [],
  };
}

async function readText(stream: ProviderRound["events"]) {
  let text = "";
  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.type === "text_delta") text += next.value.text;
      if (next.value.type === "reasoning_delta") text += next.value.text;
    }
  } finally {
    reader.releaseLock();
  }
  return text;
}
