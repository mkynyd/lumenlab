import { sanitizeModelText } from "../tool-call-parser";
import { toolResultProducedNewContent } from "../orchestrator";
import { materializePlanUpdate, parsePlanUpdate } from "../plan";
import type {
  AdapterUsage,
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
    runId?: string;
    agentExecutionId?: string;
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
  /**
   * Real-time model event hook. bufferRound must buffer each round so tool
   * calls can be parsed, but the same events are forwarded here as they
   * arrive so the HTTP stream can relay deltas while the model is still
   * generating instead of replaying everything after the round completes.
   */
  onModelEvent?: (event: ProviderStreamEvent) => void;
}

export interface AgentLoopResult {
  status: "completed" | "awaiting_approval" | "cancelled";
  finalRound: ProviderRound;
  pendingExecutionIds: string[];
  stopReason: string | null;
  /** 全部轮次（含初始轮与所有续跑轮）累计的 token 用量。 */
  usage: AdapterUsage | null;
}

export async function runAgentLoop(input: AgentLoopInput): Promise<AgentLoopResult> {
  if (input.activeTools.length === 0) {
    return completed(input.initialRound, null);
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
  const failedExecutionIds = new Set<string>();
  let loopUsage: AdapterUsage | null = null;
  const captureRoundUsage = (round: ProviderRound) => {
    const usage = round.getUsage();
    if (usage) loopUsage = mergeAdapterUsage(loopUsage, usage);
  };

  for (let round = 0; round < maxRounds; round += 1) {
    if (input.signal.aborted) {
      void roundResult.events.cancel("request aborted").catch(() => {});
      return cancelled(roundResult, loopUsage);
    }

    try {
      roundResult = await bufferRound(roundResult, input.signal, input.onModelEvent);
    } catch (error) {
      if (input.signal.aborted || isAbortError(error)) {
        return cancelled(roundResult, loopUsage);
      }
      throw error;
    }
    captureRoundUsage(roundResult);
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
        usage: loopUsage,
      };
    }

    const toolResults: ProviderToolResult[] = [];
    let roundProducedNewContent = false;
    for (const call of executable) {
      if (input.signal.aborted) return cancelled(roundResult, loopUsage);
      executedKeys.add(toolCallKey(call));
      const recoveryOfExecutionId =
        typeof call.input.recoveryOfExecutionId === "string"
          ? call.input.recoveryOfExecutionId
          : undefined;
      const toolArguments = { ...call.input };
      delete toolArguments.recoveryOfExecutionId;
      const result = await input.toolRunner.run(
        {
          call: { id: call.id, toolId: call.name, arguments: toolArguments },
          context: { ...input.context, signal: input.signal },
        },
        input.emit
      );

      if (input.signal.aborted) return cancelled(roundResult, loopUsage);

      const isDeclaredRecovery = Boolean(
        recoveryOfExecutionId && failedExecutionIds.has(recoveryOfExecutionId)
      );
      if (isDeclaredRecovery) {
        input.emit({
          type: "tool_recovery_attempted",
          failedExecutionId: recoveryOfExecutionId!,
          recoveryExecutionId: result.executionId,
        });
      }

      if (result.status === "pending_approval") {
        return {
          status: "awaiting_approval",
          finalRound: sanitizePendingRound(roundResult),
          pendingExecutionIds: [result.executionId],
          stopReason: "approval_required",
          usage: loopUsage,
        };
      }

      if (result.status === "succeeded") {
        if (call.name === "plan.update") {
          input.emit({
            type: "plan_updated",
            plan: materializePlanUpdate(parsePlanUpdate(result.summary)),
            source: "tool",
          });
        }
        toolResults.push({
          toolUseId: call.id,
          content: summarizeToolResultForModel(result.summary),
        });
        roundProducedNewContent ||= toolResultProducedNewContent(result.summary);
      } else {
        if (result.status === "failed") {
          failedExecutionIds.add(result.executionId);
        }
        toolResults.push({
          toolUseId: call.id,
          content: summarizeToolResultForModel({
            status: "failed",
            recoveryOfExecutionId: result.executionId,
            error: result.error,
          }),
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
      // 这一轮由 continueRound 产生、尚未经过 bufferRound,内容还没实时转发。
      // 缓冲并转发后再返回,保持"每一轮内容都实时送达"的契约。
      roundResult = await bufferRound(roundResult, input.signal, input.onModelEvent);
      captureRoundUsage(roundResult);
      return {
        status: "completed",
        finalRound: roundResult,
        pendingExecutionIds: [],
        stopReason: noProgress ? "no_progress" : "round_limit",
        usage: loopUsage,
      };
    }
    previousRoundProducedNewContent = roundProducedNewContent;
  }

  return {
    status: "completed",
    finalRound: roundResult,
    pendingExecutionIds: [],
    stopReason: "round_limit",
    usage: loopUsage,
  };
}

function completed(
  finalRound: ProviderRound,
  usage: AdapterUsage | null
): AgentLoopResult {
  return {
    status: "completed",
    finalRound,
    pendingExecutionIds: [],
    stopReason: null,
    usage,
  };
}

function cancelled(
  finalRound: ProviderRound,
  usage: AdapterUsage | null
): AgentLoopResult {
  return {
    status: "cancelled",
    finalRound: replaceRoundEvents(finalRound, "", ""),
    pendingExecutionIds: [],
    stopReason: "cancelled",
    usage,
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
  signal: AbortSignal,
  forward?: (event: ProviderStreamEvent) => void
): Promise<ProviderRound> {
  const reader = round.events.getReader();
  const events: ProviderStreamEvent[] = [];
  const cancel = () => {
    void reader.cancel("request aborted").catch(() => {});
  };
  if (signal.aborted) cancel();
  signal.addEventListener("abort", cancel, { once: true });
  // 转发时做全量清洗 + 增量切片(与 deepseek 传输层一致):工具调用标记
  // 只有在完整闭合时才能被移除,增量文本必须按"清洗后全文"切片,否则
  // 用户会在流式过程中看到 <tool_calls> 之类的原始标记。
  let rawText = "";
  let cleanedTextStreamed = "";
  let rawReasoning = "";
  let cleanedReasoningStreamed = "";
  const forwardCleaned = (event: ProviderStreamEvent) => {
    if (event.type === "text_delta") {
      rawText += event.text;
      const cleaned = sanitizeModelText(rawText);
      const delta = cleaned.slice(cleanedTextStreamed.length);
      cleanedTextStreamed = cleaned;
      if (delta) forward?.({ type: "text_delta", text: delta });
    } else if (event.type === "reasoning_delta") {
      rawReasoning += event.text;
      const cleaned = sanitizeModelText(rawReasoning);
      const delta = cleaned.slice(cleanedReasoningStreamed.length);
      cleanedReasoningStreamed = cleaned;
      if (delta) forward?.({ type: "reasoning_delta", text: delta });
    } else {
      forward?.(event);
    }
  };
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        events.push(value);
        forwardCleaned(value);
      }
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

const MAX_TOOL_RESULT_CHARS = 16_000;

/** 工具结果注入模型前截断,与 prelude(orchestrator)保持同一预算,防止长工具循环撑爆上下文。 */
function summarizeToolResultForModel(summary: Record<string, unknown>): string {
  const json = JSON.stringify(summary);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
  return (
    json.slice(0, MAX_TOOL_RESULT_CHARS) +
    "\n…（工具结果过长已截断，请基于已有部分继续）"
  );
}

function mergeAdapterUsage(
  total: AdapterUsage | null,
  next: AdapterUsage
): AdapterUsage {
  if (!total) return { ...next };
  return {
    prompt_tokens: total.prompt_tokens + next.prompt_tokens,
    completion_tokens: total.completion_tokens + next.completion_tokens,
    total_tokens: total.total_tokens + next.total_tokens,
    prompt_cache_hit_tokens:
      (total.prompt_cache_hit_tokens ?? 0) + (next.prompt_cache_hit_tokens ?? 0),
    prompt_cache_miss_tokens:
      (total.prompt_cache_miss_tokens ?? 0) + (next.prompt_cache_miss_tokens ?? 0),
  };
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
