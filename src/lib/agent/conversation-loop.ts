/**
 * Agent Conversation Loop
 *
 * 协调：模型流 → tool_use 抽取 → Policy Engine 决策 → ToolExecutor 执行 → 结果回填 → 下一次模型调用
 *
 * MVP：DeepSeek 模型走 web_search 服务器端工具，客户端工具不在 DeepSeek 路径上发送
 * （参见 tools/registry 的设计说明）；本循环主要负责把 web_search 触发与读取工具的副作用
 * 包装成 ToolExecution + AgentEvent 流，并保留旧 executor 的兼容路径。
 *
 * 该模块是纯服务端逻辑：调用方传入 DeepSeek 流结果 + executeTool 回调 + 事件 sink。
 */

import type { DeepSeekMessage } from "@/lib/deepseek";
import type { ToolUseBlock } from "@/lib/deepseek";
import { prisma } from "@/lib/db";
import { toolRegistry } from "./tool-registry";
import { skillRegistry } from "./skill-registry";
import {
  evaluatePolicy,
  signAndAttachToken,
} from "./policy-engine";
import { recordAuditEvent } from "./audit-log";
import {
  executeTool,
  persistExecution,
  type ToolExecutionContext,
} from "./tool-executor";
import { hashArguments } from "./approval-token";
import { buildPreview } from "./preview-builder";
import { formatAgentEvent } from "./event-stream";
import type {
  AgentContext,
  AgentEvent,
  ApprovalScope,
  RiskLevel,
  ToolExecutionStatus,
  ToolMetadata,
} from "./types";
import "@/lib/skills/registry";
import "@/lib/tools/registry";

export interface LoopInputs {
  userId: string;
  conversationId: string;
  projectId?: string;
  skillId?: string;
  apiKey: string;
  model: string;
  thinkingEnabled: boolean;
  reasoningEffort: "high" | "max";
  activeTools: ToolMetadata[];
  initialMessages: DeepSeekMessage[];
  signal: AbortSignal;
}

export interface LoopResult {
  finalStream: ReadableStream<Uint8Array>;
  getUsage: () => {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  } | null;
}

/**
 * 把 AgentEvent 注入到主输出流前面，作为 SSE 注释行；前端用 `event: agent` 名识别。
 */
class EventTap {
  private readonly encoder = new TextEncoder();
  constructor(private readonly sink: (chunk: Uint8Array) => void) {}

  emit(event: AgentEvent): void {
    this.sink(this.encoder.encode(formatAgentEvent(event)));
  }
}

const DEFAULT_USER_SCOPES = [
  "project.read",
  "project.write",
  "artifact.read",
  "artifact.write",
];

function buildAgentContext(
  inputs: LoopInputs,
  tool: ToolMetadata,
  args: Record<string, unknown>
): AgentContext {
  const skill = inputs.skillId ? skillRegistry.get(inputs.skillId) : undefined;
  return {
    user: { id: inputs.userId, scopes: DEFAULT_USER_SCOPES },
    workspace: { id: inputs.projectId ?? "default", policies: [] },
    conversation: {
      id: inputs.conversationId,
      activeSkill:
        inputs.skillId && skill
          ? { skillId: inputs.skillId, version: skill.version }
          : undefined,
      sessionApprovals: new Map(),
    },
    skill,
    tool,
    arguments: args,
    resourceContext: {
      projectId: inputs.projectId,
      selectedFileIds: undefined,
    },
  };
}

async function createExecutionRecord(args: {
  userId: string;
  conversationId: string;
  skillId: string | undefined;
  skillVersion: string | undefined;
  tool: ToolMetadata;
  toolCallArgs: Record<string, unknown>;
  riskLevel: RiskLevel;
  status: ToolExecutionStatus;
  expiresAt?: Date;
}) {
  const argumentsHash = hashArguments(args.toolCallArgs);
  return prisma.toolExecution.create({
    data: {
      userId: args.userId,
      conversationId: args.conversationId,
      skillId: args.skillId ?? null,
      skillVersion: args.skillVersion ?? null,
      toolId: args.tool.toolId,
      normalizedArguments: args.toolCallArgs,
      argumentsHash,
      riskLevel: args.riskLevel,
      status: args.status,
      expiresAt: args.expiresAt ?? null,
    },
  });
}

/**
 * 主循环：跑一次模型流，抽取 tool_use，按 Policy 决策自动执行或发审批事件。
 *
 * MVP：审批在前端发生时会通过 SSE 通知，本函数负责把 tool_use 转换成 ToolExecution 行，
 * 并对 L1/L2 工具直接执行；对 L3/L4 工具发出 approval_required 事件并等待。
 * 前端的审批/拒绝通过 /api/agent/{approve,reject} 修改 ToolExecution 状态；
 * 该循环暂不支持在流期间阻塞等待审批（MVP 由前端在 SSE 中以异步事件驱动）。
 */
export async function runAgentLoop(
  inputs: LoopInputs
): Promise<LoopResult | null> {
  // 跳过：DeepSeek 仅支持 web_search，且旧 route.ts 已经在 tool loop 中处理它。
  // 本循环目前负责把"工具调用"元数据记录到 ToolExecution 表，并通过 Tap 发出
  // agent 事件，让前端 timeline 能渲染。实际的执行/审批编排仍由 route.ts 完成。
  void inputs;
  return null;
}

export const _internalForTesting = {
  buildAgentContext,
  createExecutionRecord,
  runAutoTool: async (
    inputs: LoopInputs,
    toolUse: ToolUseBlock,
    eventTap: EventTap
  ): Promise<{ status: "succeeded" | "failed"; summary?: Record<string, unknown>; error?: string }> => {
    const tool = toolRegistry.require(toolUse.name);
    const ctx = buildAgentContext(inputs, tool, toolUse.input);
    const decision = await evaluatePolicy(ctx);
    const execution = await createExecutionRecord({
      userId: inputs.userId,
      conversationId: inputs.conversationId,
      skillId: inputs.skillId,
      skillVersion: ctx.skill?.version,
      tool,
      toolCallArgs: toolUse.input,
      riskLevel: tool.riskLevel,
      status: "proposed",
    });
    eventTap.emit({
      type: "tool_proposed",
      executionId: execution.id,
      preview: buildPreview(tool, toolUse.input, ctx),
    });
    await recordAuditEvent({
      userId: inputs.userId,
      conversationId: inputs.conversationId,
      toolExecutionId: execution.id,
      skillId: inputs.skillId,
      toolId: tool.toolId,
      eventType: "tool_proposed",
      severity: "info",
      payload: { riskLevel: tool.riskLevel },
    });

    if (decision.decision === "deny") {
      eventTap.emit({
        type: "tool_blocked",
        executionId: execution.id,
        reasonCode: decision.reasonCode,
        reason: decision.sanitizedPreview.summary,
      });
      await persistExecution(execution.id, "failed", undefined, {
        code: decision.reasonCode,
        message: decision.sanitizedPreview.summary,
      });
      return { status: "failed", error: decision.sanitizedPreview.summary };
    }

    if (decision.decision === "require_approval") {
      const token = await signAndAttachToken({
        userId: inputs.userId,
        conversationId: inputs.conversationId,
        toolId: tool.toolId,
        arguments: toolUse.input,
        requestId: execution.id,
      });
      const expiresAt = token.expiresAt.getTime();
      await prisma.toolExecution.update({
        where: { id: execution.id },
        data: {
          status: "pending_approval",
          expiresAt: token.expiresAt,
          approvalSnapshot: decision as unknown as Record<string, unknown>,
        },
      });
      eventTap.emit({
        type: "approval_required",
        executionId: execution.id,
        preview: buildPreview(tool, toolUse.input, ctx),
        token: token.token,
        expiresAt,
      });
      return { status: "failed", error: "approval_pending" };
    }

    eventTap.emit({ type: "tool_started", executionId: execution.id });
    const execResult = await executeTool(
      tool.toolId,
      {
        userId: inputs.userId,
        conversationId: inputs.conversationId,
        projectId: inputs.projectId,
      },
      toolUse.input
    );
    if (!execResult.ok) {
      eventTap.emit({
        type: "tool_failed",
        executionId: execution.id,
        errorCode: execResult.errorCode ?? "HANDLER_ERROR",
        error: execResult.errorMessage ?? "工具执行失败",
      });
      await persistExecution(execution.id, "failed", undefined, {
        code: execResult.errorCode ?? "HANDLER_ERROR",
        message: execResult.errorMessage ?? "工具执行失败",
      });
      return {
        status: "failed",
        error: execResult.errorMessage ?? "工具执行失败",
      };
    }
    eventTap.emit({
      type: "tool_completed",
      executionId: execution.id,
      resultSummary: execResult.result ?? {},
    });
    await persistExecution(execution.id, "succeeded", execResult.result);
    return { status: "succeeded", summary: execResult.result };
  },
  EventTap,
};

export type { ToolExecutionContext, ApprovalScope };