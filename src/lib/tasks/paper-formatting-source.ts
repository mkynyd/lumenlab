import { prisma } from "@/lib/db";
import type { PaperFormattingTask, PrismaClient } from "@/generated/prisma/client";
import { ACTIVE_FORMATTING_STAGES, FORMATTING_STAGE_LABELS, type FormattingStage } from "@/lib/paper/formatting-contracts";
import { normalizeTaskLimit, type TaskSnapshot, type TaskSource, type TaskStatus } from "./contracts";
export function paperFormattingSnapshot(task: PaperFormattingTask): TaskSnapshot {
  const status: TaskStatus = task.status === "needs_input" ? "waiting_user" : ["queued", "completed", "failed", "cancelled"].includes(task.status) ? task.status as TaskStatus : "running";
  return { taskId: task.id, taskType: "paper_formatting", title: (task.metadata as { title?: string }).title ?? task.originalName, status, stage: FORMATTING_STAGE_LABELS[task.status as FormattingStage], completedUnits: task.status === "mapping" ? task.completedUnits : null, totalUnits: task.status === "mapping" ? task.totalUnits : null, updatedAt: task.updatedAt.toISOString(), resultPath: `/papers/formatting/${task.id}`, canRetry: status === "failed" && task.attempt < 3, canCancel: ACTIVE_FORMATTING_STAGES.includes(task.status as FormattingStage) };
}
export class PaperFormattingTaskSource implements TaskSource {
  readonly taskType = "paper_formatting";
  constructor(private readonly client: Pick<PrismaClient, "paperFormattingTask"> = prisma) {}
  async listActive(input: { userId: string; limit?: number }): Promise<TaskSnapshot[]> {
    const tasks = await this.client.paperFormattingTask.findMany({ where: { userId: input.userId, status: { in: ACTIVE_FORMATTING_STAGES } }, orderBy: { updatedAt: "desc" }, take: normalizeTaskLimit(input.limit) });
    return tasks.map(paperFormattingSnapshot);
  }
  async getOwned(input: { userId: string; taskId: string }): Promise<TaskSnapshot | null> {
    const task = await this.client.paperFormattingTask.findFirst({ where: { userId: input.userId, id: input.taskId } });
    return task ? paperFormattingSnapshot(task) : null;
  }
}
