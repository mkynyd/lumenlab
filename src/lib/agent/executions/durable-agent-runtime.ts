import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { Prisma } from "@/generated/prisma/client";
import type {
  AgentCompletion,
  AgentRunInput,
  AgentUsage,
} from "@/lib/agent/contracts";
import type { AgentRuntimeEvent } from "@/lib/agent/runtime-events";
import { runAgentRuntime } from "@/lib/agent/runtime";
import type { AgentEvent, ToolCallPreview } from "@/lib/agent/types";
import { sanitizeModelText } from "@/lib/agent/tool-call-parser";
import { mergeAgentUsage } from "@/lib/agent/usage";
import { logger } from "@/lib/logger";
import {
  recordTokenUsage,
  type RecordTokenUsageInput,
} from "@/lib/tokens";
import type {
  AgentCheckpoint,
  AgentExecutionRecord,
} from "./agent-execution-store";
import type {
  AgentExecutionHandler,
  AgentExecutionHandlerContext,
} from "./agent-execution-runner";
import { AgentExecutionRunner } from "./agent-execution-runner";
import { AgentExecutionWorker } from "./agent-execution-worker";
import { PrismaAgentExecutionStore } from "./prisma-agent-execution-store";
import { AgentExecutionRetryPolicy } from "./retry-policy";

const OUTPUT_CHUNK_SIZE = 16_000;

function providerForModel(model: AgentRunInput["model"]["requestedModel"]) {
  if (model === "minimax-m3") return "minimax";
  if (model === "qwen3.7-plus") return "bailian";
  return "deepseek";
}

export function buildInitialAgentCheckpoint(
  input: AgentRunInput
): AgentCheckpoint {
  return {
    version: 1,
    messages: [{ role: "user", content: input.prompt.message }],
    round: 0,
    model: {
      provider: providerForModel(input.model.requestedModel),
      name: input.model.requestedModel,
    },
    skill: {
      id: input.capabilities.manualSkillId ?? null,
      version: null,
    },
    rag: {
      sourceIds: input.capabilities.selectedFileIds,
      selectedFileIds: input.capabilities.selectedFileIds,
    },
    allowedToolIds: [],
    request: {
      message: input.prompt.message,
      ...(input.prompt.hiddenPrompt
        ? { hiddenPrompt: input.prompt.hiddenPrompt }
        : {}),
      model: input.model.requestedModel,
      thinkingEnabled: input.model.thinkingEnabled,
      reasoningEffort: input.model.reasoningEffort,
      webSearchActive: input.capabilities.webSearchActive,
      ...(input.capabilities.manualSkillId
        ? { manualSkillId: input.capabilities.manualSkillId }
        : {}),
      skillOff: input.capabilities.skillOff,
      ...(input.capabilities.mode ? { mode: input.capabilities.mode } : {}),
      isQuickTask: input.capabilities.isQuickTask,
      ...(input.capabilities.materialScope
        ? { materialScope: input.capabilities.materialScope }
        : {}),
    },
  };
}

function runInputFromExecution(
  execution: AgentExecutionRecord,
  signal: AbortSignal
): AgentRunInput {
  const checkpoint = execution.checkpoint;
  const request = checkpoint?.request;
  if (
    !checkpoint ||
    !request ||
    !execution.userMessageId ||
    !execution.assistantMessageId
  ) {
    throw new Error("Durable AgentExecution is missing its request checkpoint");
  }

  return {
    user: { id: execution.userId },
    conversation: {
      id: execution.conversationId,
      ...(execution.projectId ? { projectId: execution.projectId } : {}),
    },
    prompt: {
      message: request.message,
      ...(request.hiddenPrompt ? { hiddenPrompt: request.hiddenPrompt } : {}),
      attachments: [],
    },
    model: {
      requestedModel: request.model,
      thinkingEnabled: request.thinkingEnabled,
      reasoningEffort: request.reasoningEffort,
    },
    capabilities: {
      webSearchActive: request.webSearchActive,
      ...(request.manualSkillId
        ? { manualSkillId: request.manualSkillId }
        : {}),
      skillOff: request.skillOff,
      selectedFileIds: checkpoint.rag.selectedFileIds,
      ...(request.mode ? { mode: request.mode } : {}),
      isQuickTask: request.isQuickTask,
      ...(request.materialScope
        ? { materialScope: request.materialScope }
        : {}),
    },
    durable: {
      executionId: execution.id,
      userMessageId: execution.userMessageId,
      assistantMessageId: execution.assistantMessageId,
      ...(checkpoint.usage ? { priorUsage: checkpoint.usage } : {}),
    },
    signal,
  };
}

function sanitizePreview(preview: ToolCallPreview): ToolCallPreview {
  return {
    ...preview,
    summary: preview.summary.slice(0, 500),
    affectedResources: preview.affectedResources.slice(0, 50).map((item) => ({
      ...item,
      identifier: item.identifier.slice(0, 300),
      displayName: item.displayName.slice(0, 300),
    })),
    ...(preview.externalTargets
      ? { externalTargets: preview.externalTargets.slice(0, 20) }
      : {}),
    dataTypes: preview.dataTypes.slice(0, 50),
    samplePreview: undefined,
  };
}

function sanitizeOperationalEvent(event: AgentEvent): Record<string, unknown> {
  if (event.type === "approval_required") {
    return {
      ...event,
      preview: sanitizePreview(event.preview),
      token: undefined,
    };
  }
  if (event.type === "tool_proposed") {
    return { ...event, preview: sanitizePreview(event.preview) };
  }
  if (event.type === "tool_completed") {
    return {
      type: event.type,
      executionId: event.executionId,
      resultSummary: { status: "completed" },
    };
  }
  if (event.type === "tool_failed") {
    return {
      type: event.type,
      executionId: event.executionId,
      errorCode: event.errorCode.slice(0, 160),
      error: "工具执行失败，请查看审计记录",
    };
  }
  if (event.type === "sources_updated") {
    return {
      ...event,
      sources: event.sources.slice(0, 50).map((source) => ({
        ...source,
        snippet: source.snippet?.slice(0, 500),
        metadata: undefined,
      })),
    };
  }
  return event as unknown as Record<string, unknown>;
}

function eventJson(event: AgentEvent): string | null {
  const serialized = JSON.stringify(sanitizeOperationalEvent(event));
  return serialized.length <= 18_000 ? serialized : null;
}

function eventKey(serialized: string) {
  return createHash("sha256").update(serialized).digest("hex").slice(0, 24);
}

function splitText(value: string): string[] {
  if (!value) return [];
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += OUTPUT_CHUNK_SIZE) {
    chunks.push(value.slice(index, index + OUTPUT_CHUNK_SIZE));
  }
  return chunks;
}

async function appendOperationalEvents(
  context: AgentExecutionHandlerContext,
  events: AgentEvent[]
) {
  for (const event of events) {
    const serialized = eventJson(event);
    if (!serialized) continue;
    await context.appendEvent({
      key: `agent_event:${eventKey(serialized)}`,
      type: "agent_event",
      payload: { eventJson: serialized },
    });
  }
}

async function appendOutput(
  context: AgentExecutionHandlerContext,
  checkpoint: AgentCheckpoint
) {
  const output = checkpoint.output;
  if (!output) return;
  for (const [index, text] of splitText(output.text).entries()) {
    await context.appendEvent({
      key: `assistant_text:${index}`,
      type: "assistant_text",
      payload: { text },
    });
  }
  for (const [index, text] of splitText(output.reasoning).entries()) {
    await context.appendEvent({
      key: `assistant_reasoning:${index}`,
      type: "assistant_reasoning",
      payload: { text },
    });
  }
  if (output.usage) {
    await context.appendEvent({
      key: "assistant_usage",
      type: "assistant_usage",
      payload: {
        prompt: output.usage.promptTokens,
        completion: output.usage.completionTokens,
        total: output.usage.totalTokens,
        cacheHit: output.usage.promptCacheHitTokens ?? 0,
        cacheMiss: output.usage.promptCacheMissTokens ?? 0,
      },
    });
  }
  await context.appendEvent({
    key: "assistant_committed",
    type: "assistant_committed",
    payload: { messageId: context.execution.assistantMessageId },
  });
}

function checkpointWithOutput(input: {
  checkpoint: AgentCheckpoint;
  text: string;
  reasoning: string;
  usage: AgentUsage | null;
}): AgentCheckpoint {
  const base = { ...input.checkpoint };
  delete base.pendingToolCall;
  delete base.output;
  delete base.usage;
  return {
    ...base,
    round: input.checkpoint.round + 1,
    output: {
      text: sanitizeModelText(input.text) || "（模型未输出正文）",
      reasoning: sanitizeModelText(input.reasoning),
      usage: mergeAgentUsage(input.checkpoint.usage, input.usage),
    },
  };
}

function waitingCheckpoint(input: {
  checkpoint: AgentCheckpoint;
  toolExecutionId: string;
  toolId: string;
  usage: AgentUsage | null;
}): AgentCheckpoint {
  const base = { ...input.checkpoint };
  const usage = mergeAgentUsage(input.checkpoint.usage, input.usage);
  delete base.output;
  return {
    ...base,
    round: input.checkpoint.round + 1,
    ...(usage ? { usage } : {}),
    pendingToolCall: {
      id: input.toolExecutionId,
      toolId: input.toolId,
      arguments: { toolExecutionId: input.toolExecutionId },
    },
  };
}

type DurableUsageRecorder = (
  input: RecordTokenUsageInput
) => Promise<unknown>;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

async function persistCompletedUsage(
  execution: AgentExecutionRecord,
  usage: AgentUsage | null,
  recordUsage: DurableUsageRecorder
) {
  const checkpoint = execution.checkpoint;
  if (!usage || !execution.assistantMessageId || !checkpoint) return;
  try {
    await recordUsage({
      userId: execution.userId,
      conversationId: execution.conversationId,
      messageId: execution.assistantMessageId,
      model: checkpoint.request?.model ?? checkpoint.model.name,
      provider: checkpoint.model.provider,
      inputCacheHitTokens: usage.promptCacheHitTokens ?? 0,
      inputCacheMissTokens: Math.max(
        usage.promptCacheMissTokens ?? 0,
        usage.promptTokens - (usage.promptCacheHitTokens ?? 0),
        0
      ),
      outputTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
}

function isOperationalEvent(event: AgentRuntimeEvent): event is AgentEvent {
  return ![
    "model_started",
    "text_delta",
    "reasoning_delta",
    "usage",
    "completed",
  ].includes(event.type);
}

export function createDurableAgentExecutionHandler(input: {
  run?: (runInput: AgentRunInput) => ReturnType<typeof runAgentRuntime>;
  recordUsage?: DurableUsageRecorder;
} = {}): AgentExecutionHandler {
  const run = input.run ?? runAgentRuntime;
  const recordUsage = input.recordUsage ?? recordTokenUsage;

  return async (context) => {
    const checkpoint = context.execution.checkpoint;
    if (!checkpoint?.request) {
      return {
        kind: "failed",
        code: "invalid_checkpoint",
        message: "Durable execution request checkpoint is missing",
        retryable: false,
      };
    }
    if (checkpoint.output) {
      await persistCompletedUsage(
        context.execution,
        checkpoint.output.usage,
        recordUsage
      );
      await appendOutput(context, checkpoint);
      return { kind: "completed", checkpoint };
    }

    const agentRun = await run(
      runInputFromExecution(context.execution, context.signal)
    );
    const operationalEvents: AgentEvent[] = [];
    let text = "";
    let reasoning = "";
    let streamedUsage: AgentUsage | null = null;

    for await (const event of agentRun.events) {
      if (event.type === "text_delta") text += event.text;
      else if (event.type === "reasoning_delta") reasoning += event.text;
      else if (event.type === "usage") streamedUsage = event.usage;
      else if (isOperationalEvent(event)) operationalEvents.push(event);
    }
    const completion = await agentRun.completion;
    await appendOperationalEvents(context, operationalEvents);

    if (completion.status === "awaiting_approval") {
      const approval = [...operationalEvents]
        .reverse()
        .find(
          (event): event is Extract<AgentEvent, { type: "approval_required" }> =>
            event.type === "approval_required"
        );
      if (!approval) {
        return {
          kind: "failed",
          code: "approval_checkpoint_missing",
          message: "Runtime paused without a durable approval event",
          retryable: false,
        };
      }
      return {
        kind: "waiting_approval",
        toolExecutionId: approval.executionId,
        checkpoint: waitingCheckpoint({
          checkpoint,
          toolExecutionId: approval.executionId,
          toolId: approval.preview.toolId,
          usage: completion.usage ?? streamedUsage,
        }),
      };
    }
    if (completion.status === "cancelled" || context.signal.aborted) {
      return {
        kind: "cancelled",
        code: "execution_cancelled",
        message: "Durable execution was cancelled",
        checkpoint,
      };
    }

    const finalCheckpoint = checkpointWithOutput({
      checkpoint,
      text,
      reasoning,
      usage: completion.usage ?? streamedUsage,
    });
    await context.saveCheckpoint(finalCheckpoint);
    await persistCompletedUsage(
      context.execution,
      finalCheckpoint.output?.usage ?? null,
      recordUsage
    );
    await appendOutput(context, finalCheckpoint);
    return { kind: "completed", checkpoint: finalCheckpoint };
  };
}

type WorkerGlobal = typeof globalThis & {
  __lumenAgentExecutionWorker?: AgentExecutionWorker;
};

export function startAgentExecutionWorker() {
  const globalWorker = globalThis as WorkerGlobal;
  if (globalWorker.__lumenAgentExecutionWorker?.isRunning) {
    return { started: false, workerId: "existing-process-worker" };
  }

  const store = new PrismaAgentExecutionStore();
  const retryPolicy = new AgentExecutionRetryPolicy({
    maxAttempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
  });
  const runner = new AgentExecutionRunner({
    store,
    handler: createDurableAgentExecutionHandler(),
    retryPolicy,
  });
  const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  const worker = new AgentExecutionWorker({
    workerId,
    store,
    runner,
    retryPolicy,
    leaseMs: 30_000,
    heartbeatMs: 10_000,
    pollIntervalMs: 250,
  });
  globalWorker.__lumenAgentExecutionWorker = worker;
  void worker.start().catch((error) => {
    logger.error("Agent execution worker stopped unexpectedly", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return { started: true, workerId };
}

export type DurableCompletion = AgentCompletion;
export type DurableEventPayload = Prisma.InputJsonValue;
