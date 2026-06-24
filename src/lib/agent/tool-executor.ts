/**
 * Tool Executor — Policy 通过后真正执行工具
 *
 * 每个工具以 toolId 为键注册 handler：
 *   handler(ctx, args) → 任意可序列化结果（返回对象会被序列化为 resultSummary）
 *
 * 工具实现必须自己处理：参数归一化、跨租户校验（业务层）、超时、错误码。
 */

import { prisma } from "@/lib/db";
import type { ToolMetadata } from "./types";

export interface ToolExecutionContext {
  userId: string;
  conversationId: string;
  projectId?: string;
  selectedFileIds?: string[];
}

export type ToolHandler = (
  ctx: ToolExecutionContext,
  args: Record<string, unknown>
) => Promise<Record<string, unknown>>;

const handlers = new Map<string, ToolHandler>();

export function registerToolHandler(toolId: string, handler: ToolHandler): void {
  handlers.set(toolId, handler);
}

export function hasToolHandler(toolId: string): boolean {
  return handlers.has(toolId);
}

export interface ExecutedTool {
  ok: boolean;
  result?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export async function executeTool(
  toolId: string,
  ctx: ToolExecutionContext,
  args: Record<string, unknown>
): Promise<ExecutedTool> {
  const handler = handlers.get(toolId);
  if (!handler) {
    return { ok: false, errorCode: "NO_HANDLER", errorMessage: `无处理器: ${toolId}` };
  }
  try {
    const result = await handler(ctx, args);
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      errorCode: "HANDLER_ERROR",
      errorMessage: error instanceof Error ? error.message : "工具执行失败",
    };
  }
}

/**
 * 把执行结果落库到 ToolExecution 表
 */
export async function persistExecution(
  executionId: string,
  status: "succeeded" | "failed",
  result?: Record<string, unknown>,
  error?: { code: string; message: string }
): Promise<void> {
  await prisma.toolExecution.update({
    where: { id: executionId },
    data: {
      status,
      executedAt: new Date(),
      completedAt: new Date(),
      resultSummary: result ?? null,
      errorSummary: error ?? null,
    },
  });
}

export type { ToolMetadata };