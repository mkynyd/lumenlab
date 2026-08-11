import { describe, expect, it, vi } from "vitest";

import { computeContentFingerprint } from "@/lib/files/content-fingerprint";
import { LearningServiceError } from "@/lib/learning/contracts";
import {
  createLearningService,
  resolveFileFingerprint,
} from "@/lib/learning/services/learning-service";
import type { PrismaClient } from "@/generated/prisma/client";

describe("resolveFileFingerprint", () => {
  it("uses the stored column value when present", () => {
    expect(
      resolveFileFingerprint({
        textContent: "正文",
        enhancedContent: null,
        enhancementStatus: "none",
        contentFingerprint: "sha256:stored-v1",
      })
    ).toBe("sha256:stored-v1");
  });

  it("computes a deterministic sha256:v1 fingerprint for legacy rows with a NULL column", () => {
    const content = "基尔霍夫电流定律：流入节点的电流等于流出节点的电流。";
    const legacy = {
      textContent: content,
      enhancedContent: null,
      enhancementStatus: "none",
      contentFingerprint: null,
    };
    const first = resolveFileFingerprint(legacy);
    const second = resolveFileFingerprint(legacy);
    expect(first).toBe(second);
    expect(first).toBe(computeContentFingerprint(content));
    expect(first).toMatch(/^sha256:v1:[0-9a-f]{64}$/);
  });

  it("computes over the enhanced content when the file is enhanced", () => {
    const legacy = {
      textContent: "原始正文",
      enhancedContent: "增强后的正文",
      enhancementStatus: "enhanced",
      contentFingerprint: null,
    };
    expect(resolveFileFingerprint(legacy)).toBe(
      computeContentFingerprint("增强后的正文")
    );
  });

  it("returns null when there is no readable content", () => {
    expect(
      resolveFileFingerprint({
        textContent: null,
        enhancedContent: null,
        enhancementStatus: "none",
        contentFingerprint: null,
      })
    ).toBeNull();
    expect(
      resolveFileFingerprint({
        textContent: "   ",
        enhancedContent: null,
        enhancementStatus: "none",
        contentFingerprint: null,
      })
    ).toBeNull();
  });

  it("normalizes content identically to parse-job fingerprint writes", () => {
    const legacy = {
      textContent: "  第一行\r\n第二行  \n第三行  ",
      enhancedContent: null,
      enhancementStatus: "none",
      contentFingerprint: null,
    };
    // computeContentFingerprint 应用 NFC / CRLF / 行尾空白 / trim 归一化，
    // 现算值必须与其一致，才能与锚点里保存的值稳定匹配。
    expect(resolveFileFingerprint(legacy)).toBe(
      computeContentFingerprint("第一行\n第二行\n第三行")
    );
  });

  it("treats an empty stored fingerprint as missing and recomputes", () => {
    const legacy = {
      textContent: "正文内容",
      enhancedContent: null,
      enhancementStatus: "none",
      contentFingerprint: "",
    };
    expect(resolveFileFingerprint(legacy)).toBe(
      computeContentFingerprint("正文内容")
    );
  });
});

const testClock = { now: () => new Date("2026-08-01T08:00:00.000Z") };
const testIds = { nextId: (kind: string) => `${kind}-test` };
const unusedModelGateway = {
  generateKnowledgeMap: async () => {
    throw new Error("not used");
  },
  generatePracticeItems: async () => {
    throw new Error("not used");
  },
  evaluateAttempt: async () => {
    throw new Error("not used");
  },
  generateStudyPackSection: async () => {
    throw new Error("not used");
  },
};

function createServiceWithPrisma(prisma: Record<string, unknown>) {
  return createLearningService({
    prisma: prisma as unknown as PrismaClient,
    clock: testClock,
    ids: testIds,
    modelGateway: unusedModelGateway,
  });
}

describe("deleteGoal", () => {
  function createGoalPrisma(goal: unknown) {
    const tx = {
      attemptEvaluation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      learningGoal: { delete: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      project: {
        findFirst: vi.fn().mockResolvedValue({ id: "project-1" }),
      },
      learningGoal: {
        findFirst: vi.fn().mockResolvedValue(goal),
      },
      $transaction: vi.fn(
        (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx)
      ),
      tx,
    };
    return prisma;
  }

  it("unlinks superseded evaluations before cascading the goal", async () => {
    const prisma = createGoalPrisma({ id: "goal-1" });
    const service = createServiceWithPrisma(prisma);

    await service.deleteGoal({
      userId: "user-1",
      projectId: "project-1",
      goalId: "goal-1",
    });

    expect(prisma.tx.attemptEvaluation.updateMany).toHaveBeenCalledWith({
      where: {
        supersedesEvaluationId: { not: null },
        attempt: { sessionItem: { session: { goalId: "goal-1" } } },
      },
      data: { supersedesEvaluationId: null },
    });
    expect(prisma.tx.learningGoal.delete).toHaveBeenCalledWith({
      where: { id: "goal-1" },
    });
  });

  it("fails closed when the goal belongs to another user", async () => {
    const prisma = createGoalPrisma(null);
    const service = createServiceWithPrisma(prisma);

    await expect(
      service.deleteGoal({
        userId: "user-1",
        projectId: "project-1",
        goalId: "goal-1",
      })
    ).rejects.toBeInstanceOf(LearningServiceError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("deleteStudyPack", () => {
  function createPackPrisma(pack: unknown) {
    return {
      project: {
        findFirst: vi.fn().mockResolvedValue({ id: "project-1" }),
      },
      studyPack: {
        findFirst: vi.fn().mockResolvedValue(pack),
        delete: vi.fn().mockResolvedValue({}),
      },
    };
  }

  it("deletes the owned pack and lets sections cascade", async () => {
    const prisma = createPackPrisma({ id: "pack-1", sections: [] });
    const service = createServiceWithPrisma(prisma);

    await service.deleteStudyPack({
      userId: "user-1",
      projectId: "project-1",
      packId: "pack-1",
    });

    expect(prisma.studyPack.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "pack-1",
          userId: "user-1",
        }),
      })
    );
    expect(prisma.studyPack.delete).toHaveBeenCalledWith({
      where: { id: "pack-1" },
    });
  });

  it("fails closed when the pack belongs to another user", async () => {
    const prisma = createPackPrisma(null);
    const service = createServiceWithPrisma(prisma);

    await expect(
      service.deleteStudyPack({
        userId: "user-1",
        projectId: "project-1",
        packId: "pack-1",
      })
    ).rejects.toBeInstanceOf(LearningServiceError);
    expect(prisma.studyPack.delete).not.toHaveBeenCalled();
  });
});
