import { prisma } from "@/lib/db";
import { hashArguments } from "../approval-token";
import { Prisma } from "@/generated/prisma/client";
import type {
  ToolExecutionPersistence,
  ToolProposal,
} from "./tool-execution-persistence";

export class PrismaToolExecutionAdapter implements ToolExecutionPersistence {
  async loadSessionApprovals(input: {
    userId: string;
    conversationId: string;
  }) {
    try {
      const rows = await prisma.toolExecution.findMany({
        where: {
          userId: input.userId,
          conversationId: input.conversationId,
          approvalScope: "session",
          status: "succeeded",
          riskLevel: { in: ["L0", "L1", "L2"] },
        },
        select: { toolId: true },
        distinct: ["toolId"],
      });
      return new Map(rows.map((row) => [row.toolId, "session" as const]));
    } catch {
      // Old test doubles and not-yet-migrated deployments should fail closed:
      // missing approvals merely require the user to approve again.
      return new Map<string, "session">();
    }
  }

  async propose(input: ToolProposal) {
    const argumentsHash = hashArguments(input.arguments);
    if (input.agentExecutionId) {
      const existing = await prisma.toolExecution.findFirst({
        where: {
          agentExecutionId: input.agentExecutionId,
          toolId: input.tool.toolId,
          argumentsHash,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          status: true,
          resultSummary: true,
          errorSummary: true,
        },
      });
      if (existing) return persistedProposal(existing);
    }

    const create = () => prisma.toolExecution.create({
      data: {
        agentExecutionId: input.agentExecutionId ?? null,
        providerToolCallId: input.providerToolCallId ?? null,
        userId: input.userId,
        conversationId: input.conversationId,
        skillId: input.skillId ?? null,
        skillVersion: input.skillVersion ?? null,
        toolId: input.tool.toolId,
        normalizedArguments: input.arguments as Prisma.InputJsonValue,
        argumentsHash,
        riskLevel: input.riskLevel,
        status: "proposed",
        auditMetadata: {
          executionContext: input.contextSnapshot,
        } as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        status: true,
        resultSummary: true,
        errorSummary: true,
      },
    });
    try {
      return persistedProposal(await create());
    } catch (error) {
      if (
        input.agentExecutionId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await prisma.toolExecution.findFirst({
          where: {
            agentExecutionId: input.agentExecutionId,
            OR: [
              ...(input.providerToolCallId
                ? [{ providerToolCallId: input.providerToolCallId }]
                : []),
              {
                toolId: input.tool.toolId,
                argumentsHash,
              },
            ],
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            status: true,
            resultSummary: true,
            errorSummary: true,
          },
        });
        if (existing) return persistedProposal(existing);
      }
      throw error;
    }
  }

  async markBlocked(
    executionId: string,
    error: { code: string; message: string }
  ) {
    await prisma.toolExecution.update({
      where: { id: executionId },
      data: {
        status: "blocked",
        completedAt: new Date(),
        errorSummary: error as Prisma.InputJsonValue,
      },
    });
  }

  async claimPendingAsBlocked(
    executionId: string,
    error: { code: string; message: string }
  ) {
    const claimed = await prisma.toolExecution.updateMany({
      where: { id: executionId, status: "pending_approval" },
      data: {
        status: "blocked",
        completedAt: new Date(),
        errorSummary: error as Prisma.InputJsonValue,
      },
    });
    return claimed.count === 1;
  }

  async markPendingApproval(
    executionId: string,
    input: { expiresAt: Date; approvalSnapshot: import("../types").PolicyDecision }
  ) {
    await prisma.toolExecution.update({
      where: { id: executionId },
      data: {
        status: "pending_approval",
        expiresAt: input.expiresAt,
        approvalSnapshot: input.approvalSnapshot as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async claimApprovedExecution(
    executionId: string,
    input: { scope: "once" | "session" }
  ) {
    const claimed = await prisma.toolExecution.updateMany({
      where: { id: executionId, status: "pending_approval" },
      data: {
        status: "executing",
        approvedAt: new Date(),
        executedAt: new Date(),
        approvalScope: input.scope,
      },
    });
    return claimed.count === 1;
  }

  async markExecuting(executionId: string) {
    await prisma.toolExecution.update({
      where: { id: executionId },
      data: { status: "executing", executedAt: new Date() },
    });
  }

  async markSucceeded(executionId: string, result: Record<string, unknown>) {
    await prisma.toolExecution.update({
      where: { id: executionId },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        resultSummary: result as Prisma.InputJsonValue,
        errorSummary: Prisma.JsonNull,
      },
    });
  }

  async markExecutingSucceeded(
    executionId: string,
    result: Record<string, unknown>
  ) {
    const updated = await prisma.toolExecution.updateMany({
      where: { id: executionId, status: "executing" },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        resultSummary: result as Prisma.InputJsonValue,
        errorSummary: Prisma.JsonNull,
      },
    });
    return updated.count === 1;
  }

  async markFailed(
    executionId: string,
    error: { code: string; message: string }
  ) {
    await prisma.toolExecution.update({
      where: { id: executionId },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorSummary: error as Prisma.InputJsonValue,
      },
    });
  }

  async markExecutingFailed(
    executionId: string,
    error: { code: string; message: string }
  ) {
    const updated = await prisma.toolExecution.updateMany({
      where: { id: executionId, status: "executing" },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorSummary: error as Prisma.InputJsonValue,
      },
    });
    return updated.count === 1;
  }
}

function asRecord(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function persistedProposal(input: {
  id: string;
  status: string;
  resultSummary: Prisma.JsonValue | null;
  errorSummary: Prisma.JsonValue | null;
}) {
  const error = asRecord(input.errorSummary);
  return {
    id: input.id,
    status: input.status as import("../types").ToolExecutionStatus,
    resultSummary: asRecord(input.resultSummary),
    errorSummary:
      error &&
      typeof error.code === "string" &&
      typeof error.message === "string"
        ? { code: error.code, message: error.message }
        : null,
  };
}
