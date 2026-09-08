import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { AgentExecutionStatus } from "@/lib/agent/executions/agent-execution-store";
import {
  notificationEventKey,
  safeNotificationTargetPath,
  type NotificationKind,
} from "./contracts";

type NotificationClient = Pick<PrismaClient, "notification">;
type ProjectionClient = Pick<Prisma.TransactionClient, "notification" | "agentExecution">;

export interface TaskNotificationInput {
  userId: string;
  taskType: string;
  taskId: string;
  taskAttempt: number;
  kind: NotificationKind;
  title: string;
  summary?: string | null;
  targetPath?: string | null;
  createdAt?: Date;
  /** 用户主动触发的变化（如手动取消）直接视为已提示，只进列表不弹窗。 */
  toastAcknowledgedAt?: Date;
}

/**
 * 幂等写入一条通知投影。已存在（同 userId + eventKey）时不动既有行，
 * 因此已读与“已弹出”状态不会被重放覆盖。
 */
export async function upsertTaskNotification(
  client: NotificationClient,
  input: TaskNotificationInput
): Promise<boolean> {
  const result = await client.notification.createMany({
    data: [
      {
        userId: input.userId,
        taskType: input.taskType,
        taskId: input.taskId,
        taskAttempt: input.taskAttempt,
        eventKey: notificationEventKey(input),
        kind: input.kind,
        title: input.title,
        summary: input.summary ?? null,
        targetPath: safeNotificationTargetPath(input.targetPath),
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        ...(input.toastAcknowledgedAt
          ? { toastAcknowledgedAt: input.toastAcknowledgedAt }
          : {}),
      },
    ],
    skipDuplicates: true,
  });
  return result.count > 0;
}

export function agentExecutionNotificationKind(
  status: AgentExecutionStatus
): NotificationKind | null {
  if (status === "waiting_approval") return "waiting_user";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return null;
}

const AGENT_EXECUTION_SUMMARIES: Record<NotificationKind, string> = {
  waiting_user: "有工具操作等待你的确认",
  completed: "回答已完成，点击查看结果",
  failed: "执行失败，可在对话中重试",
  cancelled: "任务已取消",
};

export function agentExecutionTargetPath(execution: {
  conversationId: string;
  projectId: string | null;
}): string {
  return execution.projectId
    ? `/projects/${execution.projectId}`
    : `/chat/${execution.conversationId}`;
}

type ExecutionNotificationRow = {
  id: string;
  userId: string;
  attempt: number;
  conversationId: string;
  projectId: string | null;
  conversation: { title: string | null } | null;
};

export function buildAgentExecutionNotification(
  execution: ExecutionNotificationRow,
  kind: NotificationKind
): TaskNotificationInput {
  const title = execution.conversation?.title?.trim() || "对话任务";
  return {
    userId: execution.userId,
    taskType: "agent_execution",
    taskId: execution.id,
    taskAttempt: execution.attempt,
    kind,
    title,
    summary: AGENT_EXECUTION_SUMMARIES[kind],
    targetPath: agentExecutionTargetPath(execution),
  };
}

/**
 * 在任务状态转换的同一事务内写入通知投影；返回是否新建。
 * 由 PrismaAgentExecutionStore 的各终态/等待态转换调用，保证任务事实与
 * 通知投影一致提交（失败时整体回滚，任务不会“完成但没通知”）。
 */
export async function notifyAgentExecutionTransition(
  client: ProjectionClient,
  input: {
    executionId: string;
    kind: NotificationKind;
    now?: Date;
    suppressToast?: boolean;
  }
): Promise<boolean> {
  const execution = await client.agentExecution.findUnique({
    where: { id: input.executionId },
    select: {
      id: true,
      userId: true,
      attempt: true,
      conversationId: true,
      projectId: true,
      conversation: { select: { title: true } },
    },
  });
  if (!execution) return false;
  return upsertTaskNotification(client, {
    ...buildAgentExecutionNotification(execution, input.kind),
    createdAt: input.now,
    ...(input.suppressToast && input.now
      ? { toastAcknowledgedAt: input.now }
      : {}),
  });
}

/**
 * 可重放的补齐：扫描近期进入终态/等待态的 AgentExecution，补上缺失的通知。
 * 用于通知投影曾写入失败、或进程在提交后崩溃的场景，可重复调用。
 */
export async function reconcileAgentExecutionNotifications(input?: {
  userId?: string;
  since?: Date;
  limit?: number;
}): Promise<{ scanned: number; created: number }> {
  const since = input?.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const limit = Math.min(Math.max(input?.limit ?? 200, 1), 1000);
  const executions = await prisma.agentExecution.findMany({
    where: {
      ...(input?.userId ? { userId: input.userId } : {}),
      status: { in: ["waiting_approval", "completed", "failed", "cancelled"] },
      updatedAt: { gte: since },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      userId: true,
      attempt: true,
      status: true,
      conversationId: true,
      projectId: true,
      conversation: { select: { title: true } },
    },
  });

  let created = 0;
  for (const execution of executions) {
    const kind = agentExecutionNotificationKind(execution.status);
    if (!kind) continue;
    const didCreate = await upsertTaskNotification(
      prisma,
      buildAgentExecutionNotification(execution, kind)
    );
    if (didCreate) created += 1;
  }
  return { scanned: executions.length, created };
}
