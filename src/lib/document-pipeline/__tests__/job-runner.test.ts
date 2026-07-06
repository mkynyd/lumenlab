import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { runFileParseJob, enqueueFileParseJobs, recoverStaleJobs } from "../job-runner";

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
    vi.mocked(prisma.fileParseJob.upsert).mockResolvedValue({ id: "job-1" } as any);
    await enqueueFileParseJobs(["f1", "f2"], "u1");
    expect(prisma.fileParseJob.upsert).toHaveBeenCalledTimes(2);
  });
});
