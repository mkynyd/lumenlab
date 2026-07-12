import { sanitizeModelText } from "../tool-call-parser";
import { toolResultProducedNewContent } from "../orchestrator";
import type {
  NormalizedToolCall,
  ProviderAdapter,
  ProviderRound,
  ProviderToolResult,
} from "../provider-adapter";
import type { ProviderStreamEvent } from "../providers/provider-event-stream";
import type { AgentAuditPayload } from "../audit-log";
import type { AgentEvent, ApprovalScope, ToolMetadata } from "../types";
import type { ToolRunner } from "../tools/tool-runner";
import type { DeepSeekMessage } from "@/lib/deepseek";

export interface AgentLoopInput {
  provider: ProviderAdapter;
  initialRound: ProviderRound;
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
  activeTools: ToolMetadata[];
  messages: DeepSeekMessage[];
  context: {
    userId: string;
    conversationId: string;
    projectId?: string;
    selectedFileIds?: string[];
    skillId?: string;
    sessionApprovals: Map<string, ApprovalScope>;
  };
  signal: AbortSignal;
  toolRunner: ToolRunner;
  emit(event: AgentEvent): void;
  audit(event: AgentAuditPayload): Promise<void>;
  preAttemptedCalls?: Array<{
    toolId: string;
    arguments: Record<string, unknown>;
  }>;
  maxRounds?: number;
}

export interface AgentLoopResult {
  status: "completed" | "awaiting_approval" | "cancelled";
  finalRound: ProviderRound;
  pendingExecutionIds: string[];
  stopReason: string | null;
}

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  if (input.activeTools.length === 0) {
    return completed(input.initialRound);
  }

  const allowedToolNames = new Set(input.activeTools.map((tool) => tool.toolId));
  const executedKeys = new Set(
    (input.preAttemptedCalls ?? []).map(
      (call) => `${call.toolId}:${stableStringify(call.arguments)}`
    )
  );
  const maxRounds = input.maxRounds ?? 8;
  let roundResult = input.initialRound;
  let messages = input.messages;
  let previousRoundProducedNewContent = true;

  for (let round = 0; round < maxRounds; round += 1) {
    if (input.signal.aborted) {
      void roundResult.events.cancel("request aborted").catch(() => {});
      return cancelled(roundResult);
    }

    try {
      roundResult = await bufferRound(roundResult, input.signal);
    } catch (error) {
      if (input.signal.aborted || isAbortError(error)) {
        return cancelled(roundResult);
      }
      throw error;
    }
    const normalizedCalls = roundResult.getToolCalls();
    const executable: NormalizedToolCall[] = [];
    const scheduledKeys = new Set(executedKeys);

    for (const call of normalizedCalls) {
      if (!allowedToolNames.has(call.name)) {
        await blockLoopCall(input, call, "NOT_IN_ALLOWLIST", `Tool ${call.name} 不在当前允许列表中`);
        continue;
      }
      const key = toolCallKey(call);
      if (scheduledKeys.has(key)) {
        await blockLoopCall(input, call, "DUPLICATE_CALL", `Tool ${call.name} 重复调用已被阻断`);
        continue;
      }
      scheduledKeys.add(key);
      executable.push(call);
    }

    if (executable.length === 0) {
      return {
        status: "completed",
        finalRound: roundResult,
        pendingExecutionIds: [],
        stopReason: previousRoundProducedNewContent ? null : "no_progress",
      };
    }

    const toolResults: ProviderToolResult[] = [];
    let roundProducedNewContent = false;
    for (const call of executable) {
      if (input.signal.aborted) return cancelled(roundResult);
      executedKeys.add(toolCallKey(call));
      const result = await input.toolRunner.run(
        {
          call: { id: call.id, toolId: call.name, arguments: call.input },
          context: { ...input.context, signal: input.signal },
        },
        input.emit
      );

      if (input.signal.aborted) return cancelled(roundResult);

      if (result.status === "pending_approval") {
        return {
          status: "awaiting_approval",
          finalRound: sanitizePendingRound(roundResult),
          pendingExecutionIds: [result.executionId],
          stopReason: "approval_required",
        };
      }

      if (result.status === "succeeded") {
        toolResults.push({
          toolUseId: call.id,
          content: JSON.stringify(result.summary),
        });
        roundProducedNewContent ||= toolResultProducedNewContent(result.summary);
      } else {
        toolResults.push({
          toolUseId: call.id,
          content: `工具执行失败: ${result.error}`,
        });
      }
    }

    const rawContent = roundResult.getRawContent();
    const noProgress = !roundProducedNewContent && !previousRoundProducedNewContent;
    const atRoundLimit = round === maxRounds - 1;
    const stopInstruction = noProgress
      ? formatWrapUpInstruction("连续两轮工具调用未产生新信息")
      : atRoundLimit
        ? formatRoundLimitInstruction()
        : undefined;

    roundResult = await input.provider.continueRound({
      model: input.model,
      messages,
      thinkingEnabled: input.thinkingEnabled,
      reasoningEffort: input.reasoningEffort,
      activeTools: input.activeTools,
      attachments: [],
      toolCalls: executable,
      toolResults,
      rawContent,
      stopInstruction,
      signal: input.signal,
    });
    messages = roundResult.requestMessages;

    if (stopInstruction) {
      return {
        status: "completed",
        finalRound: roundResult,
        pendingExecutionIds: [],
        stopReason: noProgress ? "no_progress" : "round_limit",
      };
    }
    previousRoundProducedNewContent = roundProducedNewContent;
  }

  return {
    status: "completed",
    finalRound: roundResult,
    pendingExecutionIds: [],
    stopReason: "round_limit",
  };
}

function completed(finalRound: ProviderRound): AgentLoopResult {
  return {
    status: "completed",
    finalRound,
    pendingExecutionIds: [],
    stopReason: null,
  };
}

function cancelled(finalRound: ProviderRound): AgentLoopResult {
  return {
    status: "cancelled",
    finalRound: replaceRoundEvents(finalRound, "", ""),
    pendingExecutionIds: [],
    stopReason: "cancelled",
  };
}

async function blockLoopCall(
  input: AgentLoopInput,
  call: NormalizedToolCall,
  reasonCode: string,
  reason: string
) {
  const executionId = call.id.startsWith("parsed-")
    ? `${reasonCode === "DUPLICATE_CALL" ? "dup" : "blocked"}-${call.name}`
    : call.id;
  await input.audit({
    userId: input.context.userId,
    conversationId: input.context.conversationId,
    toolId: call.name,
    eventType: "tool_blocked",
    severity: "warn",
    payload: {
      reason:
        reasonCode === "DUPLICATE_CALL"
          ? "duplicate_call"
          : "not_in_allowlist",
      reasonCode,
      input: call.input,
      source: call.source,
    },
  });
  input.emit({
    type: "tool_blocked",
    executionId,
    reasonCode,
    reason,
  });
}

async function bufferRound(
  round: ProviderRound,
  signal: AbortSignal
): Promise<ProviderRound> {
  const reader = round.events.getReader();
  const events: ProviderStreamEvent[] = [];
  const cancel = () => {
    void reader.cancel("request aborted").catch(() => {});
  };
  if (signal.aborted) cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      if (value) events.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  if (signal.aborted) throw abortError();
  return { ...round, events: replay(events) };
}

function replay(events: ProviderStreamEvent[]) {
  return new ReadableStream<ProviderStreamEvent>({
    start(controller) {
      for (const event of events) controller.enqueue(event);
      controller.close();
    },
  });
}

function sanitizePendingRound(round: ProviderRound): ProviderRound {
  const content =
    sanitizeModelText(round.getRawContent()) || "等待用户批准工具操作后继续。";
  const reasoning = sanitizeModelText(round.getRawReasoning());
  return replaceRoundEvents(round, content, reasoning);
}

function replaceRoundEvents(
  round: ProviderRound,
  content: string,
  reasoning: string
): ProviderRound {
  const events = new ReadableStream<ProviderStreamEvent>({
    start(controller) {
      if (reasoning) {
        controller.enqueue({ type: "reasoning_delta", text: reasoning });
      }
      if (content) {
        controller.enqueue({ type: "text_delta", text: content });
      }
      controller.close();
    },
  });
  return {
    ...round,
    events,
    getRawContent: () => content,
    getRawReasoning: () => reasoning,
    getToolCalls: () => [],
  };
}

function abortError() {
  return new DOMException("The operation was aborted", "AbortError");
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function toolCallKey(call: NormalizedToolCall) {
  return `${call.name}:${stableStringify(call.input)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function formatWrapUpInstruction(reason: string) {
  return [
    `工具循环因以下原因提前终止：${reason}。`,
    "请基于已经获得的工具结果，直接输出最终回答：",
    "1. 当前已完成结果；",
    "2. 未完成项（如果有）；",
    "3. 被阻断或重复调用的原因（如果有）。",
    "不要再调用新工具。",
  ].join("\n");
}

function formatRoundLimitInstruction() {
  return [
    "已达到工具调用上限。请基于已经获得的工具结果，输出最终回答：",
    "1. 当前已完成结果；",
    "2. 未完成项（如果有）；",
    "3. 被阻断、重复调用或导致无法继续的原因（如果有）。",
    "不要再调用新工具。",
  ].join("\n");
}
