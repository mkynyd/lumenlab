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
  const job = await prisma.fileParseJob.findUnique({
    where: { id: jobId },
  });
  if (!job) return;
  if (job.status === "completed" || job.status === "failed") return;

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
