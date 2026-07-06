import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Prisma } from "@/generated/prisma/client";

export const PARSE_STAGES = [
  "pending",
  "read_file",
  "parse_layout",
  "store_assets",
  "filter_images",
  "vision_analysis",
  "render",
  "rewrite_refs",
  "chunk_index",
  "complete",
] as const;

export type ParseStage = (typeof PARSE_STAGES)[number];

export const MAX_ATTEMPTS = 3;
export const STALE_JOB_MINUTES = 30;

export interface JobContext {
  jobId: string;
  userId: string;
  fileAssetId: string;
  stage: ParseStage;
  attempt: number;
}

export async function enqueueFileParseJobs(
  fileAssetIds: string[],
  userId: string
): Promise<void> {
  for (const fileAssetId of [...new Set(fileAssetIds)]) {
    const job = await prisma.fileParseJob.upsert({
      where: { fileAssetId },
      create: {
        userId,
        fileAssetId,
        status: "pending",
        stage: "pending",
        attempt: 0,
      },
      update: {
        status: "pending",
        stage: "pending",
        attempt: 0,
        error: null,
        completedAt: null,
        startedAt: null,
      },
    });
    // Fire-and-forget; runner is responsible for durability.
    void runFileParseJob(job.id);
  }
}

export async function recoverStaleJobs(maxAgeMinutes = STALE_JOB_MINUTES): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
  const result = await prisma.fileParseJob.updateMany({
    where: {
      status: "running",
      updatedAt: { lt: cutoff },
    },
    data: {
      status: "pending",
      stage: "pending",
      attempt: 0,
    },
  });
  return result.count;
}

/**
 * Recover stale jobs and start processing all pending jobs.
 * Intended to be called once at application startup (e.g. from instrumentation.ts).
 */
export async function startParseJobWorker(): Promise<{ recovered: number; pending: number }> {
  // On startup, any job still marked as running is no longer actually running,
  // so reset all running jobs to pending before draining the queue.
  const recovered = await recoverStaleJobs(0);
  const jobs = await prisma.fileParseJob.findMany({
    where: { status: "pending" },
    select: { id: true },
  });
  for (const job of jobs) {
    void runFileParseJob(job.id);
  }
  return { recovered, pending: jobs.length };
}

async function updateJob(
  jobId: string,
  data: Prisma.FileParseJobUpdateInput
): Promise<void> {
  await prisma.fileParseJob.update({
    where: { id: jobId },
    data,
  });
}

export async function runFileParseJob(jobId: string): Promise<void> {
  let job = await prisma.fileParseJob.findUnique({
    where: { id: jobId },
  });
  if (!job) return;
  if (job.status === "completed" || job.status === "failed") return;

  while (job.attempt < MAX_ATTEMPTS) {
    await updateJob(jobId, {
      status: "running",
      startedAt: job.startedAt || new Date(),
    });

    const stage = PARSE_STAGES.includes(job.stage as ParseStage)
      ? (job.stage as ParseStage)
      : "pending";

    try {
      await executeStages({
        jobId,
        userId: job.userId,
        fileAssetId: job.fileAssetId,
        stage,
        attempt: job.attempt,
      });
      await updateJob(jobId, {
        status: "completed",
        stage: "complete",
        completedAt: new Date(),
        error: null,
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextAttempt: number = job.attempt + 1;
      if (nextAttempt >= MAX_ATTEMPTS) {
        try {
          await updateJob(jobId, {
            status: "failed",
            error: message.slice(0, 500),
            completedAt: new Date(),
          });
        } catch (persistError) {
          logger.error("Failed to persist job failure state", {
            jobId,
            error: persistError instanceof Error ? persistError.message : String(persistError),
          });
        }
        return;
      }
      await updateJob(jobId, {
        status: "pending",
        stage: "pending",
        attempt: nextAttempt,
        error: message.slice(0, 500),
      });
      job = { ...job, attempt: nextAttempt, stage: "pending", status: "pending" };
    }
  }
}

async function executeStages(ctx: JobContext): Promise<void> {
  const { runParseStages } = await import("@/lib/files/parse-job");
  await runParseStages(
    ctx,
    async (stage: ParseStage, data: { attempt: number; warnings: string[] }) => {
      await updateJob(ctx.jobId, {
        stage,
        attempt: data.attempt,
        warnings: data.warnings,
      });
    }
  );
}
