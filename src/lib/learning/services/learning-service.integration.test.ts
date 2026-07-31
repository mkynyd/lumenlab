import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  LearningServiceError,
  type LearningClock,
  type LearningIdGenerator,
  type LearningModelGateway,
} from "@/lib/learning/contracts";
import { PrismaClient } from "@/generated/prisma/client";
import { createLearningService } from "@/lib/learning/services/learning-service";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const clock: LearningClock = {
  now: () => new Date("2026-07-31T08:00:00.000Z"),
};

function createIds(): LearningIdGenerator {
  let sequence = 0;
  return {
    nextId: (kind) => `${kind}-${++sequence}-${randomUUID()}`,
  };
}

const unusedModelGateway: LearningModelGateway = {
  generateKnowledgeMap: async () => {
    throw new Error("not used");
  },
  generatePracticeItems: async () => {
    throw new Error("not used");
  },
  evaluateAttempt: async () => {
    throw new Error("not used");
  },
};

async function createFixture() {
  const suffix = randomUUID();
  const [owner, stranger] = await Promise.all([
    prisma.user.create({
      data: {
        email: `learning-owner-${suffix}@example.test`,
        passwordHash: "integration-only",
      },
    }),
    prisma.user.create({
      data: {
        email: `learning-stranger-${suffix}@example.test`,
        passwordHash: "integration-only",
      },
    }),
  ]);
  const project = await prisma.project.create({
    data: {
      userId: owner.id,
      name: "Learning service fixture",
    },
  });
  return { owner, stranger, project };
}

describe("LearningService goal and scope seam", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it("creates historical goals and confirms only an owned draft scope", async () => {
    const { owner, stranger, project } = await createFixture();
    const service = createLearningService({
      prisma,
      clock,
      ids: createIds(),
      modelGateway: unusedModelGateway,
    });

    try {
      const created = await service.createGoal({
        userId: owner.id,
        projectId: project.id,
        input: {
          title: "掌握电路基础",
          purpose: "准备期末考试",
          targetDate: null,
          dailyMinutes: 45,
          activate: true,
          idempotencyKey: "goal-create-1",
        },
      });

      await expect(
        service.createGoal({
          userId: owner.id,
          projectId: project.id,
          input: {
            title: "掌握电路基础",
            purpose: "准备期末考试",
            targetDate: null,
            dailyMinutes: 45,
            activate: true,
            idempotencyKey: "goal-create-1",
          },
        })
      ).resolves.toEqual(created);

      await expect(
        service.listGoals({
          userId: owner.id,
          projectId: project.id,
        })
      ).resolves.toMatchObject({
        goals: [
          {
            id: created.id,
            title: "掌握电路基础",
            status: "active",
          },
        ],
      });

      const draft = await service.saveScopeDraft({
        userId: owner.id,
        projectId: project.id,
        goalId: created.id,
        input: {
          expectedVersion: 0,
          definition: { chapters: ["第一章", "第二章"] },
          materialMode: "project_corpus",
          fileIds: [],
          materialGaps: ["缺少历年题"],
          idempotencyKey: "scope-draft-1",
        },
      });

      expect(draft).toMatchObject({
        version: 1,
        status: "draft",
        materialMode: "project_corpus",
        materialGaps: ["缺少历年题"],
      });

      await expect(
        service.confirmScope({
          userId: owner.id,
          projectId: project.id,
          goalId: created.id,
          input: {
            expectedVersion: 1,
            idempotencyKey: "scope-confirm-1",
          },
        })
      ).resolves.toMatchObject({
        id: draft.id,
        version: 1,
        status: "confirmed",
        confirmedAt: "2026-07-31T08:00:00.000Z",
      });

      await expect(
        service.listGoals({
          userId: stranger.id,
          projectId: project.id,
        })
      ).rejects.toMatchObject({
        code: "not_found",
        status: 404,
      } satisfies Partial<LearningServiceError>);
    } finally {
      await prisma.user.deleteMany({
        where: { id: { in: [owner.id, stranger.id] } },
      });
    }
  });

  it("persists a versioned map and returns a five-item session without private answers", async () => {
    const { owner, stranger, project } = await createFixture();
    const file = await prisma.fileAsset.create({
      data: {
        userId: owner.id,
        projectId: project.id,
        filename: "circuit.md",
        originalName: "电路原理.md",
        mimeType: "text/markdown",
        size: 64,
        storagePath: "integration/circuit.md",
        textContent: "基尔霍夫电流定律：流入节点的电流等于流出节点的电流。",
        contentFingerprint: "sha256:circuit-v1",
        status: "parsed",
      },
    });
    let observedMapInput: unknown;
    let observedPracticeInput: unknown;
    const modelGateway: LearningModelGateway = {
      async generateKnowledgeMap(input) {
        observedMapInput = input;
        const source = (
          input as { sources: Array<{ handle: string }> }
        ).sources[0];
        return {
          points: [
            {
              stableKey: "kirchhoff-current-law",
              name: "基尔霍夫电流定律",
              kind: "concept",
              order: 0,
              predecessorStableKeys: [],
              sourceHandles: [source.handle],
            },
          ],
        };
      },
      async generatePracticeItems(input) {
        observedPracticeInput = input;
        const source = (
          input as { sources: Array<{ handle: string }> }
        ).sources[0];
        return {
          items: Array.from({ length: 5 }, (_, index) => ({
            stableKey: `kcl-diagnostic-${index + 1}`,
            prompt: `题目 ${index + 1}：节点电流是否守恒？`,
            type: "true_false",
            mode: "evidence_bearing",
            answerCriteria: { kind: "boolean", expected: true },
            explanation: "依据基尔霍夫电流定律。",
            sourceHandles: [source.handle],
            knowledgePointStableKeys: ["kirchhoff-current-law"],
            predecessorStableKeys: [],
          })),
        };
      },
      async evaluateAttempt() {
        throw new Error("not used");
      },
    };
    const service = createLearningService({
      prisma,
      clock,
      ids: createIds(),
      modelGateway,
    });

    try {
      const goal = await service.createGoal({
        userId: owner.id,
        projectId: project.id,
        input: {
          title: "电路诊断",
          purpose: null,
          targetDate: null,
          dailyMinutes: 30,
          activate: true,
          idempotencyKey: "map-goal",
        },
      });
      await service.saveScopeDraft({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: {
          expectedVersion: 0,
          definition: { objective: "诊断节点定律" },
          materialMode: "project_corpus",
          fileIds: [],
          materialGaps: [],
          idempotencyKey: "map-scope",
        },
      });
      await service.confirmScope({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: {
          expectedVersion: 1,
          idempotencyKey: "map-scope-confirm",
        },
      });

      const map = await service.generateMap({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: { idempotencyKey: "map-generate-1" },
      });

      expect(map).toMatchObject({
        version: 1,
        points: [
          {
            stableKey: "kirchhoff-current-law",
            freshness: "current",
          },
        ],
      });
      expect(observedMapInput).toMatchObject({
        sources: [
          {
            fileAssetId: file.id,
            title: "电路原理.md",
            contentFingerprint: "sha256:circuit-v1",
          },
        ],
      });

      const session = await service.createDiagnosticSession({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: { idempotencyKey: "diagnostic-1" },
      });
      expect(session.mode).toBe("diagnostic");
      expect(session.status).toBe("ready");
      expect(session.items).toHaveLength(5);
      expect(observedPracticeInput).toMatchObject({
        sources: [
          {
            fileAssetId: file.id,
            content:
              "基尔霍夫电流定律：流入节点的电流等于流出节点的电流。",
          },
        ],
      });
      expect(JSON.stringify(session)).not.toMatch(
        /answerCriteria|criteria|explanation|generationMetadata/
      );

      await expect(
        service.getSession({
          userId: stranger.id,
          projectId: project.id,
          sessionId: session.id,
        })
      ).rejects.toMatchObject({
        code: "not_found",
        status: 404,
      });
    } finally {
      await prisma.user.deleteMany({
        where: { id: { in: [owner.id, stranger.id] } },
      });
    }
  });

  it("derives assistance and spacing on the server while same-item review resolves the wrong answer", async () => {
    const { owner, project } = await createFixture();
    let now = new Date("2026-07-31T08:00:00.000Z");
    const mutableClock: LearningClock = {
      now: () => new Date(now),
    };
    const service = createLearningService({
      prisma,
      clock: mutableClock,
      ids: createIds(),
      modelGateway: unusedModelGateway,
    });

    try {
      const goal = await service.createGoal({
        userId: owner.id,
        projectId: project.id,
        input: {
          title: "同题复习",
          purpose: "验证错题闭环",
          targetDate: null,
          dailyMinutes: 20,
          activate: true,
          idempotencyKey: "attempt-goal",
        },
      });
      const scope = await prisma.learningScope.create({
        data: {
          goalId: goal.id,
          version: 1,
          status: "confirmed",
          definition: { objective: "节点电流定律" },
          materialMode: "project_corpus",
          confirmedAt: now,
        },
      });
      const map = await prisma.knowledgeMap.create({
        data: {
          goalId: goal.id,
          scopeId: scope.id,
          version: 1,
          sourceFingerprint: "sha256:attempt-map",
        },
      });
      const file = await prisma.fileAsset.create({
        data: {
          userId: owner.id,
          projectId: project.id,
          filename: "attempt.md",
          originalName: "节点定律.md",
          mimeType: "text/markdown",
          size: 32,
          storagePath: "integration/attempt.md",
          textContent: "流入节点的电流等于流出节点的电流。",
          contentFingerprint: "sha256:attempt-v1",
          status: "parsed",
        },
      });
      const anchor = await prisma.sourceAnchor.create({
        data: {
          projectId: project.id,
          anchorKey: "attempt-anchor",
          fileAssetId: file.id,
          originalFileAssetId: file.id,
          sourceFileName: file.originalName,
          locator: { kind: "file" },
          contentFingerprint: file.contentFingerprint!,
          excerptHash: "sha256:attempt-excerpt",
        },
      });
      const pointLineage = await prisma.knowledgePointLineage.create({
        data: {
          goalId: goal.id,
          stableKey: "kcl",
        },
      });
      const point = await prisma.knowledgePoint.create({
        data: {
          knowledgeMapId: map.id,
          lineageId: pointLineage.id,
          name: "节点电流定律",
          kind: "concept",
          orderIndex: 0,
          sourceLinks: {
            create: { sourceAnchorId: anchor.id },
          },
        },
      });
      const itemLineage = await prisma.practiceItemLineage.create({
        data: {
          goalId: goal.id,
          stableKey: "kcl-boolean",
        },
      });
      const item = await prisma.practiceItem.create({
        data: {
          goalId: goal.id,
          knowledgeMapId: map.id,
          lineageId: itemLineage.id,
          version: 1,
          prompt: "节点中的电流满足守恒关系吗？",
          type: "true_false",
          mode: "evidence_bearing",
          freshness: "current",
          answerSpec: {
            create: {
              criteria: { kind: "boolean", expected: true },
              explanation: "依据基尔霍夫电流定律，节点电流代数和为零。",
              graderPolicyVersion: "learning-grading-v1",
            },
          },
          knowledgePoints: {
            create: { knowledgePointId: point.id },
          },
          sourceLinks: {
            create: { sourceAnchorId: anchor.id },
          },
        },
      });

      const createSessionItem = async (idempotencyKey: string) => {
        const session = await prisma.learningSession.create({
          data: {
            userId: owner.id,
            goalId: goal.id,
            knowledgeMapId: map.id,
            mode: idempotencyKey === "diagnostic-session"
              ? "diagnostic"
              : "review",
            status: "ready",
            idempotencyKey,
            items: {
              create: {
                practiceItemId: item.id,
                orderIndex: 0,
              },
            },
          },
          include: { items: true },
        });
        return {
          sessionId: session.id,
          sessionItemId: session.items[0].id,
        };
      };

      const diagnostic = await createSessionItem("diagnostic-session");
      await expect(
        service.revealAnswer({
          userId: owner.id,
          projectId: project.id,
          ...diagnostic,
          input: { idempotencyKey: "early-answer" },
        })
      ).rejects.toMatchObject({
        code: "answer_not_available",
        status: 409,
      });

      const hint = await service.revealHint({
        userId: owner.id,
        projectId: project.id,
        ...diagnostic,
        input: { idempotencyKey: "hint-1" },
      });
      await expect(
        service.revealHint({
          userId: owner.id,
          projectId: project.id,
          ...diagnostic,
          input: { idempotencyKey: "hint-1" },
        })
      ).resolves.toEqual(hint);

      const first = await service.submitAttempt({
        userId: owner.id,
        projectId: project.id,
        ...diagnostic,
        input: {
          idempotencyKey: "attempt-1",
          answer: false,
        },
      });
      expect(first).toMatchObject({
        attempt: {
          assistanceLevel: "hinted",
          spacingSeconds: 0,
        },
        evaluation: {
          verdict: "incorrect",
        },
        progress: [
          {
            lineageId: pointLineage.id,
            masteryState: "learning",
          },
        ],
      });
      await expect(
        service.submitAttempt({
          userId: owner.id,
          projectId: project.id,
          ...diagnostic,
          input: {
            idempotencyKey: "attempt-1",
            answer: false,
          },
        })
      ).resolves.toMatchObject({
        attempt: { id: first.attempt.id },
        evaluation: { id: first.evaluation.id },
      });
      await expect(
        service.submitAttempt({
          userId: owner.id,
          projectId: project.id,
          ...diagnostic,
          input: {
            idempotencyKey: "attempt-1",
            answer: true,
          },
        })
      ).rejects.toMatchObject({
        code: "idempotency_conflict",
        status: 409,
      });

      const answer = await service.revealAnswer({
        userId: owner.id,
        projectId: project.id,
        ...diagnostic,
        input: { idempotencyKey: "answer-after-attempt" },
      });
      expect(answer.feedback.explanation).toContain("基尔霍夫");
      expect(JSON.stringify(answer)).not.toMatch(/answerCriteria|criteria|expected/);

      now = new Date("2026-08-02T08:00:00.000Z");
      await expect(
        service.listReviews({
          userId: owner.id,
          projectId: project.id,
          goalId: goal.id,
        })
      ).resolves.toMatchObject({
        reviews: [
          {
            lineageId: pointLineage.id,
            reviewState: "due",
          },
        ],
      });
      const review = await service.createReviewSession({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: {
          idempotencyKey: "review-session-1",
          limit: 10,
        },
      });
      expect(review.items[0].practiceItem.lineageId).toBe(itemLineage.id);

      const second = await service.submitAttempt({
        userId: owner.id,
        projectId: project.id,
        sessionId: review.id,
        sessionItemId: review.items[0].id,
        input: {
          idempotencyKey: "attempt-2",
          answer: true,
        },
      });
      expect(second).toMatchObject({
        attempt: {
          assistanceLevel: "independent",
          spacingSeconds: 172800,
        },
        evaluation: { verdict: "correct" },
      });
      await expect(
        service.listWrongAnswers({
          userId: owner.id,
          projectId: project.id,
          goalId: goal.id,
        })
      ).resolves.toMatchObject({
        items: [
          {
            itemLineageId: itemLineage.id,
            status: "resolved",
          },
        ],
      });

      now = new Date("2026-08-09T08:00:00.000Z");
      const secondReview = await service.createReviewSession({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: {
          idempotencyKey: "review-session-2",
          limit: 10,
        },
      });
      const third = await service.submitAttempt({
        userId: owner.id,
        projectId: project.id,
        sessionId: secondReview.id,
        sessionItemId: secondReview.items[0].id,
        input: {
          idempotencyKey: "attempt-3",
          answer: true,
        },
      });
      expect(third.progress[0].masteryState).toBe("learning");

      now = new Date("2026-08-20T08:00:00.000Z");
      const thirdReview = await service.createReviewSession({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: {
          idempotencyKey: "review-session-3",
          limit: 10,
        },
      });
      const fourth = await service.submitAttempt({
        userId: owner.id,
        projectId: project.id,
        sessionId: thirdReview.id,
        sessionItemId: thirdReview.items[0].id,
        input: {
          idempotencyKey: "attempt-4",
          answer: true,
        },
      });
      expect(fourth.progress[0].masteryState).toBe("mastered");
      await expect(
        service.getProgress({
          userId: owner.id,
          projectId: project.id,
          goalId: goal.id,
        })
      ).resolves.toMatchObject({
        summary: {
          total: 1,
          mastered: 1,
        },
      });
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });

  it("revalidates only objects anchored to changed or deleted material", async () => {
    const { owner, project } = await createFixture();
    const service = createLearningService({
      prisma,
      clock,
      ids: createIds(),
      modelGateway: unusedModelGateway,
    });

    try {
      const goal = await service.createGoal({
        userId: owner.id,
        projectId: project.id,
        input: {
          title: "资料局部失效",
          purpose: null,
          targetDate: null,
          dailyMinutes: 20,
          activate: true,
          idempotencyKey: "freshness-goal",
        },
      });
      const scope = await prisma.learningScope.create({
        data: {
          goalId: goal.id,
          version: 1,
          status: "confirmed",
          definition: { objective: "局部重验证" },
          materialMode: "project_corpus",
          confirmedAt: clock.now(),
        },
      });
      const map = await prisma.knowledgeMap.create({
        data: {
          goalId: goal.id,
          scopeId: scope.id,
          version: 1,
          sourceFingerprint: "sha256:freshness-map",
        },
      });
      const [changedFile, stableFile] = await Promise.all([
        prisma.fileAsset.create({
          data: {
            userId: owner.id,
            projectId: project.id,
            filename: "changed.md",
            originalName: "会变化.md",
            mimeType: "text/markdown",
            size: 16,
            storagePath: "integration/changed.md",
            textContent: "旧内容",
            contentFingerprint: "sha256:changed-v1",
            status: "parsed",
          },
        }),
        prisma.fileAsset.create({
          data: {
            userId: owner.id,
            projectId: project.id,
            filename: "stable.md",
            originalName: "稳定.md",
            mimeType: "text/markdown",
            size: 16,
            storagePath: "integration/stable.md",
            textContent: "稳定内容",
            contentFingerprint: "sha256:stable-v1",
            status: "parsed",
          },
        }),
      ]);
      const [changedAnchor, stableAnchor] = await Promise.all([
        prisma.sourceAnchor.create({
          data: {
            projectId: project.id,
            anchorKey: "changed-anchor",
            fileAssetId: changedFile.id,
            originalFileAssetId: changedFile.id,
            sourceFileName: changedFile.originalName,
            locator: { kind: "file" },
            contentFingerprint: changedFile.contentFingerprint!,
            excerptHash: "sha256:changed-excerpt",
          },
        }),
        prisma.sourceAnchor.create({
          data: {
            projectId: project.id,
            anchorKey: "stable-anchor",
            fileAssetId: stableFile.id,
            originalFileAssetId: stableFile.id,
            sourceFileName: stableFile.originalName,
            locator: { kind: "file" },
            contentFingerprint: stableFile.contentFingerprint!,
            excerptHash: "sha256:stable-excerpt",
          },
        }),
      ]);
      const createPoint = async (
        stableKey: string,
        orderIndex: number,
        anchorIds: string[]
      ) => {
        const lineage = await prisma.knowledgePointLineage.create({
          data: { goalId: goal.id, stableKey },
        });
        return prisma.knowledgePoint.create({
          data: {
            knowledgeMapId: map.id,
            lineageId: lineage.id,
            name: stableKey,
            kind: "concept",
            orderIndex,
            sourceLinks: {
              create: anchorIds.map((sourceAnchorId) => ({
                sourceAnchorId,
              })),
            },
          },
        });
      };
      const [changedOnly, alternative, unrelated] = await Promise.all([
        createPoint("changed-only", 0, [changedAnchor.id]),
        createPoint("with-alternative", 1, [
          changedAnchor.id,
          stableAnchor.id,
        ]),
        createPoint("unrelated", 2, [stableAnchor.id]),
      ]);
      const createItem = async (
        stableKey: string,
        pointId: string,
        anchorIds: string[]
      ) => {
        const lineage = await prisma.practiceItemLineage.create({
          data: { goalId: goal.id, stableKey },
        });
        return prisma.practiceItem.create({
          data: {
            goalId: goal.id,
            knowledgeMapId: map.id,
            lineageId: lineage.id,
            version: 1,
            prompt: `${stableKey} 是否正确？`,
            type: "true_false",
            mode: "evidence_bearing",
            answerSpec: {
              create: {
                criteria: { kind: "boolean", expected: true },
                explanation: "资料解释",
                graderPolicyVersion: "learning-grading-v1",
              },
            },
            knowledgePoints: {
              create: { knowledgePointId: pointId },
            },
            sourceLinks: {
              create: anchorIds.map((sourceAnchorId) => ({
                sourceAnchorId,
              })),
            },
          },
        });
      };
      const [changedItem, alternativeItem, unrelatedItem] =
        await Promise.all([
          createItem(
            "changed-item",
            changedOnly.id,
            [changedAnchor.id]
          ),
          createItem(
            "alternative-item",
            alternative.id,
            [changedAnchor.id, stableAnchor.id]
          ),
          createItem(
            "unrelated-item",
            unrelated.id,
            [stableAnchor.id]
          ),
        ]);

      await expect(
        service.recordFileContentChange({
          userId: owner.id,
          fileAssetId: changedFile.id,
          previousFingerprint: "sha256:changed-v1",
          currentFingerprint: "sha256:changed-v1",
        })
      ).resolves.toEqual({
        changed: false,
        knowledgePoints: [],
        practiceItems: [],
      });

      const changed = await service.recordFileContentChange({
        userId: owner.id,
        fileAssetId: changedFile.id,
        previousFingerprint: "sha256:changed-v1",
        currentFingerprint: "sha256:changed-v2",
      });
      expect(changed.knowledgePoints).toEqual(
        expect.arrayContaining([
          {
            id: changedOnly.id,
            freshness: "needs_revalidation",
          },
          {
            id: alternative.id,
            freshness: "needs_revalidation",
          },
        ])
      );
      expect(changed.knowledgePoints).not.toEqual(
        expect.arrayContaining([{ id: unrelated.id }])
      );
      expect(changed.practiceItems).toEqual(
        expect.arrayContaining([
          {
            id: changedItem.id,
            freshness: "needs_revalidation",
          },
          {
            id: alternativeItem.id,
            freshness: "needs_revalidation",
          },
        ])
      );
      expect(changed.practiceItems).not.toEqual(
        expect.arrayContaining([{ id: unrelatedItem.id }])
      );
      await expect(
        prisma.knowledgePoint.findUniqueOrThrow({
          where: { id: unrelated.id },
          select: { freshness: true },
        })
      ).resolves.toEqual({ freshness: "current" });

      const staleSession = await prisma.learningSession.create({
        data: {
          userId: owner.id,
          goalId: goal.id,
          knowledgeMapId: map.id,
          mode: "review",
          status: "ready",
          idempotencyKey: "stale-session",
          items: {
            create: {
              practiceItemId: changedItem.id,
              orderIndex: 0,
            },
          },
        },
        include: { items: true },
      });
      await expect(
        service.submitAttempt({
          userId: owner.id,
          projectId: project.id,
          sessionId: staleSession.id,
          sessionItemId: staleSession.items[0].id,
          input: {
            idempotencyKey: "stale-attempt",
            answer: true,
          },
        })
      ).rejects.toMatchObject({
        code: "source_unsupported",
        status: 409,
      });

      await service.recordFileDeletion({
        userId: owner.id,
        fileAssetId: changedFile.id,
        previousFingerprint: "sha256:changed-v1",
      });
      await expect(
        prisma.knowledgePoint.findMany({
          where: { id: { in: [changedOnly.id, alternative.id] } },
          orderBy: { orderIndex: "asc" },
          select: { id: true, freshness: true },
        })
      ).resolves.toEqual([
        { id: changedOnly.id, freshness: "unsupported" },
        { id: alternative.id, freshness: "needs_revalidation" },
      ]);
      await expect(
        prisma.practiceItem.findUniqueOrThrow({
          where: { id: changedItem.id },
          select: { freshness: true },
        })
      ).resolves.toEqual({ freshness: "unsupported" });
      await expect(
        prisma.practiceItem.findUniqueOrThrow({
          where: { id: alternativeItem.id },
          select: { freshness: true },
        })
      ).resolves.toEqual({ freshness: "needs_revalidation" });
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });
});
