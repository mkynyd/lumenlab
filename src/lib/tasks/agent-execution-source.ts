import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { AgentExecutionStatus } from "@/lib/agent/executions/agent-execution-store";
import {
  normalizeTaskLimit,
  type TaskSnapshot,
  type TaskSource,
  type TaskStatus,
} from "./contracts";

/** 用户主动重试的上限，与 store.retryOwned 默认值保持一致。 */
export const AGENT_EXECUTION_USER_RETRY_MAX_ATTEMPTS = 5;

const ACTIVE_EXECUTION_STATUSES: AgentExecutionStatus[] = [
  "queued",
  "running",
  "waiting_approval",
];

const FINISHED_TOOL_STATUSES = [
  "succeeded",
  "failed",
  "blocked",
  "rejected",
  "expired",
  "cancelled",
];

type TaskClient = Pick<PrismaClient, "agentExecution">;

export function toTaskStatus(status: AgentExecutionStatus): TaskStatus {
  if (status === "waiting_approval") return "waiting_user";
  return status;
}

function stageFor(input: {
  status: AgentExecutionStatus;
  executingTools: number;
  finishedTools: number;
}): string {
  if (input.status === "queued") return "排队等待执行";
  if (input.status === "waiting_approval") return "等待你的确认";
  if (input.executingTools > 0) return "正在执行工具";
  if (input.finishedTools > 0) return "正在整理回答";
  return "正在生成回答";
}

function resultPathFor(execution: {
  conversationId: string;
  projectId: string | null;
}): string {
  // 服务器生成的站内允许路径：项目会话回到项目页，普通会话回到对话页。
  return execution.projectId
    ? `/projects/${execution.projectId}`
    : `/chat/${execution.conversationId}`;
}

function titleFor(execution: { conversation: { title: string | null } | null }): string {
  const title = execution.conversation?.title?.trim();
  return title && title.length > 0 ? title : "对话任务";
}

export class AgentExecutionTaskSource implements TaskSource {
  readonly taskType = "agent_execution";

  constructor(private readonly client: TaskClient = prisma) {}

  async listActive(input: {
    userId: string;
    limit?: number;
  }): Promise<TaskSnapshot[]> {
    const executions = await this.client.agentExecution.findMany({
      where: { userId: input.userId, conversation: { kind: "chat" }, status: { in: ACTIVE_EXECUTION_STATUSES } },
      orderBy: { updatedAt: "desc" },
      take: normalizeTaskLimit(input.limit),
      select: {
        id: true,
        status: true,
        attempt: true,
        updatedAt: true,
        conversationId: true,
        projectId: true,
        conversation: { select: { title: true } },
        _count: {
          select: {
            toolExecutions: { where: { status: { in: FINISHED_TOOL_STATUSES } } },
          },
        },
      },
    });

    if (executions.length === 0) return [];

    const executing = await this.client.agentExecution.findMany({
      where: {
        id: { in: executions.map((execution) => execution.id) },
        userId: input.userId,
      },
      select: {
        id: true,
        _count: {
          select: {
            toolExecutions: {
              where: { status: { in: ["approved", "executing"] } },
            },
          },
        },
      },
    });
    const executingById = new Map(
      executing.map((row) => [row.id, row._count.toolExecutions])
    );

    return executions.map((execution) => {
      const finishedTools = execution._count.toolExecutions;
      const executingTools = executingById.get(execution.id) ?? 0;
      return {
        taskId: execution.id,
        taskType: this.taskType,
        title: titleFor(execution),
        status: toTaskStatus(execution.status),
        stage: stageFor({
          status: execution.status,
          executingTools,
          finishedTools,
        }),
        completedUnits: finishedTools,
        totalUnits: null,
        updatedAt: execution.updatedAt.toISOString(),
        resultPath: resultPathFor(execution),
        canRetry: false,
        canCancel: true,
      };
    });
  }

  async getOwned(input: {
    userId: string;
    taskId: string;
  }): Promise<TaskSnapshot | null> {
    const execution = await this.client.agentExecution.findFirst({
      where: { id: input.taskId, userId: input.userId, conversation: { kind: "chat" } },
      select: {
        id: true,
        status: true,
        attempt: true,
        updatedAt: true,
        conversationId: true,
        projectId: true,
        conversation: { select: { title: true } },
        _count: {
          select: {
            toolExecutions: { where: { status: { in: FINISHED_TOOL_STATUSES } } },
          },
        },
      },
    });
    if (!execution) return null;

    const executing = await this.client.agentExecution.findFirst({
      where: { id: execution.id, userId: input.userId },
      select: {
        _count: {
          select: {
            toolExecutions: {
              where: { status: { in: ["approved", "executing"] } },
            },
          },
        },
      },
    });

    const finishedTools = execution._count.toolExecutions;
    const status = toTaskStatus(execution.status);
    const retryable =
      (execution.status === "failed" || execution.status === "cancelled") &&
      execution.attempt < AGENT_EXECUTION_USER_RETRY_MAX_ATTEMPTS;

    return {
      taskId: execution.id,
      taskType: this.taskType,
      title: titleFor(execution),
      status,
      stage: stageFor({
        status: execution.status,
        executingTools: executing?._count.toolExecutions ?? 0,
        finishedTools,
      }),
      completedUnits: finishedTools,
      totalUnits: null,
      updatedAt: execution.updatedAt.toISOString(),
      resultPath: resultPathFor(execution),
      canRetry: retryable,
      canCancel: ACTIVE_EXECUTION_STATUSES.includes(execution.status),
    };
  }
}
