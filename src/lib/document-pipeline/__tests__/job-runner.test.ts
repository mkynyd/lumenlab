import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runFileParseJob,
  enqueueFileParseJobs,
  recoverStaleJobs,
  startParseJobWorker,
  MAX_ATTEMPTS,
} from "../job-runner";
import { runParseStages } from "@/lib/files/parse-job";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  prisma: {
    fileParseJob: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/files/parse-job", () => ({
  runParseStages: vi.fn(),
}));

describe("job runner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("recovers stale running jobs", async () => {
    vi.mocked(prisma.fileParseJob.updateMany).mockResolvedValue({ count: 2 });
    const count = await recoverStaleJobs(30);
    expect(count).toBe(2);
    expect(prisma.fileParseJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "running" }),
        data: { status: "pending", stage: "pending", attempt: 0 },
      })
    );
  });

  it("enqueues jobs for file assets", async () => {
    vi.mocked(prisma.fileParseJob.upsert).mockResolvedValue({ id: "job-1" } as never);
    await enqueueFileParseJobs(["f1", "f2"], "u1");
    expect(prisma.fileParseJob.upsert).toHaveBeenCalledTimes(2);
  });

  it("starts the worker by recovering stale jobs and processing pending jobs", async () => {
    vi.mocked(prisma.fileParseJob.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.fileParseJob.findMany).mockResolvedValue([
      { id: "job-1" },
      { id: "job-2" },
    ] as never);
    vi.mocked(prisma.fileParseJob.findUnique).mockResolvedValue({
      id: "job-1",
      userId: "user-1",
      fileAssetId: "file-1",
      status: "pending",
      stage: "pending",
      attempt: 0,
      strategy: null,
      costEstimate: null,
      startedAt: null,
      error: null,
      warnings: [],
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(runParseStages).mockResolvedValue(undefined);

    const result = await startParseJobWorker();

    expect(result).toEqual({ recovered: 1, pending: 2 });
    expect(prisma.fileParseJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "running" }),
      })
    );
    expect(prisma.fileParseJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "pending" },
        select: { id: true },
      })
    );
  });

  describe("runFileParseJob", () => {
    const baseJob = {
      id: "job-1",
      userId: "user-1",
      fileAssetId: "file-1",
      status: "pending",
      stage: "pending",
      attempt: 0,
      strategy: null,
      costEstimate: null,
      startedAt: null,
      error: null,
      warnings: [],
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it("updates job to completed on success", async () => {
      vi.mocked(prisma.fileParseJob.findUnique).mockResolvedValue(baseJob);
      vi.mocked(runParseStages).mockResolvedValue(undefined);

      await runFileParseJob("job-1");

      expect(runParseStages).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "job-1" }),
        expect.any(Function)
      );
      expect(prisma.fileParseJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: "job-1" },
          data: expect.objectContaining({
            status: "completed",
            stage: "complete",
            error: null,
          }),
        })
      );
    });

    it("updates job to failed after max attempts", async () => {
      vi.mocked(prisma.fileParseJob.findUnique).mockResolvedValue(baseJob);
      vi.mocked(runParseStages).mockRejectedValue(new Error("parse failed"));

      await runFileParseJob("job-1");

      expect(runParseStages).toHaveBeenCalledTimes(MAX_ATTEMPTS);
      expect(prisma.fileParseJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: "job-1" },
          data: expect.objectContaining({
            status: "failed",
            error: "parse failed",
          }),
        })
      );
    });

    it("retries and completes when a later attempt succeeds", async () => {
      vi.mocked(prisma.fileParseJob.findUnique).mockResolvedValue(baseJob);
      vi.mocked(runParseStages)
        .mockRejectedValueOnce(new Error("transient"))
        .mockResolvedValueOnce(undefined);

      await runFileParseJob("job-1");

      expect(runParseStages).toHaveBeenCalledTimes(2);
      expect(prisma.fileParseJob.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: "job-1" },
          data: expect.objectContaining({
            status: "completed",
            stage: "complete",
            error: null,
          }),
        })
      );
    });

    it("treats invalid stage as pending", async () => {
      vi.mocked(prisma.fileParseJob.findUnique).mockResolvedValue({
        ...baseJob,
        stage: "invalid_stage",
      });
      vi.mocked(runParseStages).mockResolvedValue(undefined);

      await runFileParseJob("job-1");

      expect(runParseStages).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "pending" }),
        expect.any(Function)
      );
    });

    it("skips terminal jobs", async () => {
      vi.mocked(prisma.fileParseJob.findUnique).mockResolvedValue({
        ...baseJob,
        status: "completed",
      });

      await runFileParseJob("job-1");

      expect(runParseStages).not.toHaveBeenCalled();
      expect(prisma.fileParseJob.update).not.toHaveBeenCalled();
    });
  });
});
