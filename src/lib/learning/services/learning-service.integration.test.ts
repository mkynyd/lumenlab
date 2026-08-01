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
  generateStudyPackSection: async () => {
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

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe("LearningService goal and scope seam", () => {

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
      async generateStudyPackSection() {
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
      const distractorLineage = await prisma.practiceItemLineage.create({
        data: {
          goalId: goal.id,
          stableKey: "kcl-different-question",
        },
      });
      await prisma.practiceItem.create({
        data: {
          goalId: goal.id,
          knowledgeMapId: map.id,
          lineageId: distractorLineage.id,
          version: 1,
          prompt: "流出节点的电流可以忽略吗？",
          type: "true_false",
          mode: "evidence_bearing",
          freshness: "current",
          createdAt: new Date("2026-08-01T08:00:00.000Z"),
          answerSpec: {
            create: {
              criteria: { kind: "boolean", expected: false },
              explanation: "节点电流必须满足守恒关系。",
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
      // A newer alternate question covers the same point, but an unresolved
      // wrong answer must prefer the same item lineage for explicit redo.
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

  it("resolves block-level locators from current chunks when generating a map", async () => {
    const { owner, project } = await createFixture();
    const file = await prisma.fileAsset.create({
      data: {
        userId: owner.id,
        projectId: project.id,
        filename: "blocked.md",
        originalName: "分块资料.md",
        mimeType: "text/markdown",
        size: 128,
        storagePath: "integration/blocked.md",
        textContent:
          "第一章 直流电路。基尔霍夫电流定律：流入节点的电流等于流出节点的电流。",
        contentFingerprint: "sha256:blocked-v1",
        status: "parsed",
      },
    });
    await prisma.documentChunk.createMany({
      data: [
        {
          id: "chunk-blocked-0",
          userId: owner.id,
          projectId: project.id,
          fileAssetId: file.id,
          content: "第一章 直流电路。",
          contentHash: "hash-a",
          chunkIndex: 0,
          metadata: { blockId: "blk-0", pageNumber: 1, sourceType: "paragraph" },
        },
        {
          id: "chunk-blocked-1",
          userId: owner.id,
          projectId: project.id,
          fileAssetId: file.id,
          content: "基尔霍夫电流定律：流入节点的电流等于流出节点的电流。",
          contentHash: "hash-b",
          chunkIndex: 1,
          metadata: { blockId: "blk-1", pageNumber: 2, sourceType: "paragraph" },
        },
      ],
    });
    const modelGateway: LearningModelGateway = {
      async generateKnowledgeMap(input) {
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
              sourceHandles: [source.handle],
            },
          ],
        };
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
          title: "分块定位",
          purpose: null,
          targetDate: null,
          dailyMinutes: 30,
          activate: true,
          idempotencyKey: "blocked-goal",
        },
      });
      await service.saveScopeDraft({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: {
          expectedVersion: 0,
          definition: { objective: "分块定位" },
          materialMode: "project_corpus",
          fileIds: [],
          materialGaps: [],
          idempotencyKey: "blocked-scope",
        },
      });
      await service.confirmScope({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: {
          expectedVersion: 1,
          idempotencyKey: "blocked-scope-confirm",
        },
      });
      const map = await service.generateMap({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: { idempotencyKey: "blocked-map-1" },
      });
      expect(map).toMatchObject({
        points: [{ stableKey: "kirchhoff-current-law" }],
      });
      const anchor = await prisma.sourceAnchor.findFirstOrThrow({
        where: { projectId: project.id, fileAssetId: file.id },
      });
      expect(anchor.documentChunkId).toBe("chunk-blocked-0");
      expect(anchor.locator).toEqual({
        kind: "block",
        blockId: "blk-0",
        pageNumber: 1,
      });
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });

  it("returns evidence-backed history and appends an owned error-type correction", async () => {
    const { owner, stranger, project } = await createFixture();
    const service = createLearningService({
      prisma,
      clock,
      ids: createIds(),
      modelGateway: unusedModelGateway,
    });

    try {
      const file = await prisma.fileAsset.create({
        data: {
          userId: owner.id,
          projectId: project.id,
          filename: "history.md",
          originalName: "学习档案资料.md",
          mimeType: "text/markdown",
          size: 32,
          storagePath: "integration/history.md",
          textContent: "节点电流满足守恒关系。",
          contentFingerprint: "sha256:history-v1",
          status: "parsed",
        },
      });
      const goal = await service.createGoal({
        userId: owner.id,
        projectId: project.id,
        input: {
          title: "理解节点电流",
          purpose: "验证学习档案",
          targetDate: null,
          dailyMinutes: 20,
          activate: true,
          idempotencyKey: "history-goal",
        },
      });
      const scope = await prisma.learningScope.create({
        data: {
          goalId: goal.id,
          version: 1,
          status: "confirmed",
          definition: { objective: "节点电流" },
          materialMode: "project_corpus",
          confirmedAt: clock.now(),
        },
      });
      const map = await prisma.knowledgeMap.create({
        data: {
          goalId: goal.id,
          scopeId: scope.id,
          version: 1,
          sourceFingerprint: "sha256:history-map",
        },
      });
      const anchor = await prisma.sourceAnchor.create({
        data: {
          projectId: project.id,
          anchorKey: "history-anchor",
          fileAssetId: file.id,
          originalFileAssetId: file.id,
          sourceFileName: file.originalName,
          locator: { kind: "paragraph", paragraph: 1 },
          contentFingerprint: file.contentFingerprint!,
          excerptHash: "sha256:history-excerpt",
        },
      });
      const pointLineage = await prisma.knowledgePointLineage.create({
        data: { goalId: goal.id, stableKey: "node-current" },
      });
      const point = await prisma.knowledgePoint.create({
        data: {
          knowledgeMapId: map.id,
          lineageId: pointLineage.id,
          name: "节点电流守恒",
          kind: "concept",
          orderIndex: 0,
          sourceLinks: { create: { sourceAnchorId: anchor.id } },
        },
      });
      const itemLineage = await prisma.practiceItemLineage.create({
        data: { goalId: goal.id, stableKey: "node-current-check" },
      });
      const item = await prisma.practiceItem.create({
        data: {
          goalId: goal.id,
          knowledgeMapId: map.id,
          lineageId: itemLineage.id,
          version: 1,
          prompt: "流入节点的电流是否等于流出节点的电流？",
          type: "true_false",
          mode: "evidence_bearing",
          answerSpec: {
            create: {
              criteria: { kind: "boolean", expected: true },
              explanation: "节点电流满足守恒。",
              graderPolicyVersion: "learning-grading-v1",
            },
          },
          knowledgePoints: {
            create: { knowledgePointId: point.id },
          },
          sourceLinks: { create: { sourceAnchorId: anchor.id } },
        },
      });
      const session = await prisma.learningSession.create({
        data: {
          userId: owner.id,
          goalId: goal.id,
          knowledgeMapId: map.id,
          mode: "diagnostic",
          status: "completed",
          startedAt: new Date("2026-07-31T07:50:00.000Z"),
          completedAt: new Date("2026-07-31T08:00:00.000Z"),
        },
      });
      const sessionItem = await prisma.learningSessionItem.create({
        data: {
          sessionId: session.id,
          practiceItemId: item.id,
          orderIndex: 0,
          status: "completed",
        },
      });
      const attempt = await prisma.practiceAttempt.create({
        data: {
          userId: owner.id,
          sessionItemId: sessionItem.id,
          answer: false,
          assistanceLevel: "independent",
          spacingSeconds: 0,
          idempotencyKey: "history-attempt",
          submittedAt: new Date("2026-07-31T07:58:00.000Z"),
        },
      });
      const evaluation = await prisma.attemptEvaluation.create({
        data: {
          attemptId: attempt.id,
          verdict: "incorrect",
          score: 0,
          confidence: 1,
          errorType: "knowledge_gap",
          reason: "boolean_mismatch",
          policyVersion: "learning-grading-v1",
          createdAt: new Date("2026-07-31T07:59:00.000Z"),
        },
      });
      await prisma.knowledgePointProgress.create({
        data: {
          userId: owner.id,
          goalId: goal.id,
          lineageId: pointLineage.id,
          masteryState: "learning",
          nextReviewAt: new Date("2026-07-31T08:00:00.000Z"),
          policyVersion: "progress-v1",
          evidenceAsOf: evaluation.createdAt,
        },
      });

      const initialHistory = await service.getHistory({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
      });
      expect(initialHistory).toMatchObject({
        summary: {
          totalPoints: 1,
          weakPoints: 1,
          dueReviews: 1,
          attempts: 1,
          manualCorrections: 0,
        },
        points: [
          {
            lineageId: pointLineage.id,
            name: "节点电流守恒",
            evidence: [
              {
                activeEvaluationId: evaluation.id,
                effectiveErrorType: {
                  value: "knowledge_gap",
                  source: "evaluation",
                },
                practiceItem: {
                  sourceAnchors: [
                    { sourceFileName: "学习档案资料.md" },
                  ],
                },
              },
            ],
          },
        ],
      });
      expect(
        initialHistory.points[0].evidence[0].practiceItem
      ).not.toHaveProperty("answerCriteria");
      expect(
        initialHistory.points[0].evidence[0].evaluations[0]
      ).not.toHaveProperty("rubric");
      expect(initialHistory).not.toHaveProperty("generationMetadata");

      const correctionCommand = {
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        evaluationId: evaluation.id,
        input: {
          errorType: "misconception" as const,
          reason: "我把流入和流出的方向定义混淆了",
          idempotencyKey: "history-correction",
        },
      };
      const correction = await service.correctEvaluationErrorType(
        correctionCommand
      );
      await expect(
        service.correctEvaluationErrorType(correctionCommand)
      ).resolves.toEqual(correction);
      await expect(
        service.correctEvaluationErrorType({
          ...correctionCommand,
          input: {
            ...correctionCommand.input,
            errorType: "method_choice",
          },
        })
      ).rejects.toMatchObject({
        code: "idempotency_conflict",
        status: 409,
      } satisfies Partial<LearningServiceError>);

      const correctedHistory = await service.getHistory({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
      });
      expect(correctedHistory.summary.manualCorrections).toBe(1);
      expect(correctedHistory.points[0].evidence[0]).toMatchObject({
        activeEvaluationId: evaluation.id,
        effectiveErrorType: {
          value: "misconception",
          source: "user_correction",
          sourceId: correction.correction.id,
        },
        evaluations: [
          {
            id: evaluation.id,
            errorType: "knowledge_gap",
            corrections: [
              {
                id: correction.correction.id,
                errorType: "misconception",
              },
            ],
          },
        ],
      });

      const regrade = await prisma.attemptEvaluation.create({
        data: {
          attemptId: attempt.id,
          verdict: "partial",
          score: 0.5,
          confidence: 0.9,
          errorType: "method_choice",
          reason: "manual_regrade",
          policyVersion: "learning-grading-v1",
          supersedesEvaluationId: evaluation.id,
          createdAt: new Date("2026-07-31T08:01:00.000Z"),
        },
      });
      const regradedHistory = await service.getHistory({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
      });
      expect(regradedHistory.points[0].evidence[0]).toMatchObject({
        activeEvaluationId: regrade.id,
        effectiveErrorType: {
          value: "method_choice",
          source: "evaluation",
          sourceId: regrade.id,
        },
      });
      await expect(
        service.correctEvaluationErrorType({
          ...correctionCommand,
          input: {
            ...correctionCommand.input,
            idempotencyKey: "superseded-correction",
          },
        })
      ).rejects.toMatchObject({
        code: "invalid_state",
        status: 409,
      } satisfies Partial<LearningServiceError>);

      await expect(
        service.correctEvaluationErrorType({
          ...correctionCommand,
          userId: stranger.id,
          input: {
            ...correctionCommand.input,
            idempotencyKey: "stranger-correction",
          },
        })
      ).rejects.toMatchObject({ code: "not_found", status: 404 });
    } finally {
      await prisma.user.deleteMany({
        where: { id: { in: [owner.id, stranger.id] } },
      });
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

describe("P1-B regrades, goal revisions, and profile resets", () => {
  async function setupP1bScenario() {
    const { owner, stranger, project } = await createFixture();
    let now = new Date("2026-08-01T08:00:00.000Z");
    const clock: LearningClock = { now: () => now };
    const service = createLearningService({
      prisma,
      clock,
      ids: createIds(),
      modelGateway: unusedModelGateway,
    });
    const suffix = randomUUID();
    const goal = await prisma.learningGoal.create({
      data: {
        userId: owner.id,
        projectId: project.id,
        title: "电路基础",
        purpose: null,
        targetDate: null,
        dailyMinutes: 30,
      },
    });
    const scope = await prisma.learningScope.create({
      data: {
        goalId: goal.id,
        version: 1,
        status: "confirmed",
        definition: { objective: "诊断" },
        materialMode: "project_corpus",
        confirmedAt: now,
      },
    });
    const map = await prisma.knowledgeMap.create({
      data: {
        goalId: goal.id,
        scopeId: scope.id,
        version: 1,
        sourceFingerprint: "sha256:p1b-map",
      },
    });
    const file = await prisma.fileAsset.create({
      data: {
        userId: owner.id,
        projectId: project.id,
        filename: "p1b.md",
        originalName: "节点定律.md",
        mimeType: "text/markdown",
        size: 32,
        storagePath: "integration/p1b.md",
        textContent: "流入节点的电流等于流出节点的电流。",
        contentFingerprint: "sha256:p1b-v1",
        status: "parsed",
      },
    });
    const anchor = await prisma.sourceAnchor.create({
      data: {
        projectId: project.id,
        anchorKey: `p1b-anchor-${suffix}`,
        fileAssetId: file.id,
        originalFileAssetId: file.id,
        sourceFileName: file.originalName,
        locator: { kind: "file" },
        contentFingerprint: file.contentFingerprint!,
        excerptHash: "sha256:p1b-excerpt",
      },
    });
    const pointLineage = await prisma.knowledgePointLineage.create({
      data: { goalId: goal.id, stableKey: `kcl-${suffix}` },
    });
    const point = await prisma.knowledgePoint.create({
      data: {
        knowledgeMapId: map.id,
        lineageId: pointLineage.id,
        name: "节点电流定律",
        kind: "concept",
        orderIndex: 0,
        sourceLinks: { create: { sourceAnchorId: anchor.id } },
      },
    });
    const itemLineage = await prisma.practiceItemLineage.create({
      data: { goalId: goal.id, stableKey: `kcl-boolean-${suffix}` },
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
            explanation: "依据基尔霍夫电流定律。",
            graderPolicyVersion: "learning-grading-v1",
          },
        },
        knowledgePoints: { create: { knowledgePointId: point.id } },
        sourceLinks: { create: { sourceAnchorId: anchor.id } },
      },
    });
    const session = await prisma.learningSession.create({
      data: {
        userId: owner.id,
        goalId: goal.id,
        knowledgeMapId: map.id,
        mode: "diagnostic",
        status: "ready",
        idempotencyKey: `p1b-session-${suffix}`,
        items: { create: { practiceItemId: item.id, orderIndex: 0 } },
      },
      include: { items: true },
    });
    const submit = (answer: boolean, idempotencyKey: string) =>
      service.submitAttempt({
        userId: owner.id,
        projectId: project.id,
        sessionId: session.id,
        sessionItemId: session.items[0].id,
        input: { idempotencyKey, answer },
      });
    const advance = (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    };
    return {
      owner,
      stranger,
      project,
      service,
      goal,
      pointLineage,
      itemLineage,
      session,
      submit,
      advance,
      suffix,
    };
  }

  it("regrades append a superseding evaluation and reproject progress", async () => {
    const { owner, stranger, project, service, goal, submit } =
      await setupP1bScenario();
    try {
      const first = await submit(false, "p1b-attempt-1");
      expect(first.evaluation.verdict).toBe("incorrect");

      const regraded = await service.regradeEvaluation({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        evaluationId: first.evaluation.id,
        input: {
          verdict: "correct",
          errorType: "misconception",
          reason: "判定有误，应为正确",
          idempotencyKey: "p1b-regrade-1",
        },
      });
      expect(regraded.regrade).toMatchObject({
        verdict: "correct",
        errorType: "misconception",
        supersedesEvaluationId: first.evaluation.id,
        policyVersion: "manual-regrade-v1",
      });
      expect(regraded.progress).toHaveLength(1);

      const evaluations = await prisma.attemptEvaluation.findMany({
        where: { attemptId: first.attempt.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      expect(evaluations).toHaveLength(2);
      expect(evaluations[0].id).toBe(first.evaluation.id);
      expect(evaluations[1].supersedesEvaluationId).toBe(
        first.evaluation.id
      );

      const history = await service.getHistory({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
      });
      expect(history.points[0].evidence[0].evaluations).toHaveLength(2);
      expect(history.points[0].evidence[0].activeEvaluationId).toBe(
        regraded.regrade.id
      );

      await expect(
        service.regradeEvaluation({
          userId: stranger.id,
          projectId: project.id,
          goalId: goal.id,
          evaluationId: first.evaluation.id,
          input: {
            verdict: "correct",
            reason: "越权纠正",
            idempotencyKey: "p1b-regrade-stranger",
          },
        })
      ).rejects.toMatchObject({ code: "not_found", status: 404 });
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });

  it("regrades are idempotent and reject conflicts on non-active evaluations", async () => {
    const { owner, project, service, goal, submit } = await setupP1bScenario();
    try {
      const first = await submit(false, "p1b-attempt-2");
      const input = {
        verdict: "correct" as const,
        reason: "判定有误",
        idempotencyKey: "p1b-regrade-2",
      };
      const applied = await service.regradeEvaluation({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        evaluationId: first.evaluation.id,
        input,
      });
      await expect(
        service.regradeEvaluation({
          userId: owner.id,
          projectId: project.id,
          goalId: goal.id,
          evaluationId: first.evaluation.id,
          input,
        })
      ).resolves.toEqual(applied);

      await expect(
        service.regradeEvaluation({
          userId: owner.id,
          projectId: project.id,
          goalId: goal.id,
          evaluationId: first.evaluation.id,
          input: {
            verdict: "incorrect",
            reason: "判定有误",
            idempotencyKey: "p1b-regrade-2",
          },
        })
      ).rejects.toMatchObject({
        code: "idempotency_conflict",
        status: 409,
      });

      // The superseded evaluation is no longer active and cannot be regraded
      // again through a fresh key.
      await expect(
        service.regradeEvaluation({
          userId: owner.id,
          projectId: project.id,
          goalId: goal.id,
          evaluationId: first.evaluation.id,
          input: {
            verdict: "partial",
            reason: "再次纠正",
            idempotencyKey: "p1b-regrade-3",
          },
        })
      ).rejects.toMatchObject({ code: "invalid_state", status: 409 });
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });

  it("rejects regrading evidence that predates a reset boundary", async () => {
    const { owner, project, service, goal, submit } = await setupP1bScenario();
    try {
      const first = await submit(false, "p1b-attempt-3");
      await service.resetProfile({
        userId: owner.id,
        projectId: project.id,
        input: {
          scope: { kind: "goal", goalId: goal.id },
          reason: "重新开始",
          idempotencyKey: "p1b-reset-before-regrade",
        },
      });
      await expect(
        service.regradeEvaluation({
          userId: owner.id,
          projectId: project.id,
          goalId: goal.id,
          evaluationId: first.evaluation.id,
          input: {
            verdict: "correct",
            reason: "尝试纠正重置前的记录",
            idempotencyKey: "p1b-regrade-old",
          },
        })
      ).rejects.toMatchObject({ code: "invalid_state", status: 409 });
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });

  it("revises goals with a revision snapshot, idempotency and conflict semantics", async () => {
    const { owner, project, service, goal } = await setupP1bScenario();
    try {
      const revised = await service.reviseGoal({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: {
          title: "电路基础进阶",
          purpose: "准备期末考试",
          reason: "学习目标调整",
          idempotencyKey: "p1b-revise-1",
        },
      });
      expect(revised.goal).toMatchObject({
        title: "电路基础进阶",
        purpose: "准备期末考试",
      });
      expect(revised.revision).toMatchObject({
        goalId: goal.id,
        title: "电路基础进阶",
        purpose: "准备期末考试",
        reason: "学习目标调整",
      });

      const snapshotCount = await prisma.learningGoalRevision.count({
        where: { goalId: goal.id },
      });
      expect(snapshotCount).toBe(1);

      await expect(
        service.reviseGoal({
          userId: owner.id,
          projectId: project.id,
          goalId: goal.id,
          input: {
            title: "电路基础进阶",
            purpose: "准备期末考试",
            reason: "学习目标调整",
            idempotencyKey: "p1b-revise-1",
          },
        })
      ).resolves.toEqual(revised);

      await expect(
        service.reviseGoal({
          userId: owner.id,
          projectId: project.id,
          goalId: goal.id,
          input: {
            title: "完全不同",
            reason: "学习目标调整",
            idempotencyKey: "p1b-revise-1",
          },
        })
      ).rejects.toMatchObject({
        code: "idempotency_conflict",
        status: 409,
      });

      await expect(
        service.reviseGoal({
          userId: owner.id,
          projectId: project.id,
          goalId: goal.id,
          input: {
            title: "电路基础进阶",
            reason: "没有实际变化",
            idempotencyKey: "p1b-revise-2",
          },
        })
      ).rejects.toMatchObject({ code: "invalid_state", status: 400 });
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });

  it("goal resets clear projections and never resurrect old evidence", async () => {
    const { owner, project, service, goal, submit, advance } =
      await setupP1bScenario();
    try {
      await submit(false, "p1b-attempt-4");
      const progressBefore = await service.getProgress({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
      });
      expect(progressBefore.points[0].masteryState).toBe("learning");

      const reset = await service.resetProfile({
        userId: owner.id,
        projectId: project.id,
        input: {
          scope: { kind: "goal", goalId: goal.id },
          reason: "重新开始",
          idempotencyKey: "p1b-reset-goal",
        },
      });
      expect(reset.reset).toMatchObject({
        scope: { kind: "goal", goalId: goal.id },
        reason: "重新开始",
      });
      expect(reset.reset.affectedPointCount).toBe(1);

      const progressAfter = await service.getProgress({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
      });
      expect(progressAfter.points[0]).toMatchObject({
        masteryState: "new",
        nextReviewAt: null,
        evidenceAsOf: null,
      });

      // New evidence after the boundary participates normally.
      advance(3_600_000);
      await submit(true, "p1b-attempt-5");
      const history = await service.getHistory({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
      });
      expect(history.points[0].resetAt).not.toBeNull();
      expect(history.points[0].evidence).toHaveLength(2);
      const [newEvidence, oldEvidence] = history.points[0].evidence;
      expect(newEvidence.resetBefore).toBe(false);
      expect(oldEvidence.resetBefore).toBe(true);
      expect(history.summary.attempts).toBe(1);

      const wrong = await service.listWrongAnswers({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
      });
      const attemptIds = wrong.items.flatMap((item) =>
        item.attempts.map((attempt) => attempt.id)
      );
      expect(attemptIds).toHaveLength(0);

      // The active projection still honors the boundary after another
      // projection pass (reproject after regrade path).
      const latestProgress = await service.getProgress({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
      });
      expect(latestProgress.points[0].evidenceAsOf).not.toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });

  it("point and user scopes reset exactly the intended projections", async () => {
    const { owner, project, service, goal, pointLineage, submit, suffix } =
      await setupP1bScenario();
    try {
      // A second lineage so point scope can be distinguished from goal scope.
      const secondLineage = await prisma.knowledgePointLineage.create({
        data: { goalId: goal.id, stableKey: `kcl-second-${suffix}` },
      });
      await prisma.knowledgePoint.create({
        data: {
          knowledgeMapId: (
            await prisma.knowledgeMap.findFirstOrThrow({
              where: { goalId: goal.id },
            })
          ).id,
          lineageId: secondLineage.id,
          name: "欧姆定律",
          kind: "concept",
          orderIndex: 1,
        },
      });

      await submit(false, "p1b-attempt-6");
      await service.resetProfile({
        userId: owner.id,
        projectId: project.id,
        input: {
          scope: { kind: "point", goalId: goal.id, lineageId: pointLineage.id },
          reason: "只重置第一个知识点",
          idempotencyKey: "p1b-reset-point",
        },
      });
      const progress = await service.getProgress({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
      });
      const byLineage = new Map(
        progress.points.map((point) => [point.lineageId, point])
      );
      expect(byLineage.get(pointLineage.id)).toMatchObject({
        masteryState: "new",
      });

      await service.resetProfile({
        userId: owner.id,
        projectId: project.id,
        input: {
          scope: { kind: "user" },
          reason: "全部重置",
          idempotencyKey: "p1b-reset-user",
        },
      });
      const progressAfterUserReset = await service.getProgress({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
      });
      for (const point of progressAfterUserReset.points) {
        expect(point.masteryState).toBe("new");
      }

      // Same key with a different scope conflicts.
      await expect(
        service.resetProfile({
          userId: owner.id,
          projectId: project.id,
          input: {
            scope: { kind: "goal", goalId: goal.id },
            reason: "全部重置",
            idempotencyKey: "p1b-reset-user",
          },
        })
      ).rejects.toMatchObject({
        code: "idempotency_conflict",
        status: 409,
      });
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });

  it("resets are idempotent and reject cross-tenant goals", async () => {
    const { owner, stranger, project, service, goal, suffix } =
      await setupP1bScenario();
    try {
      const input = {
        scope: { kind: "goal" as const, goalId: goal.id },
        reason: "重新开始",
        idempotencyKey: `p1b-reset-${suffix}`,
      };
      const applied = await service.resetProfile({
        userId: owner.id,
        projectId: project.id,
        input,
      });
      await expect(
        service.resetProfile({ userId: owner.id, projectId: project.id, input })
      ).resolves.toEqual(applied);

      const strangerProject = await prisma.project.create({
        data: {
          userId: stranger.id,
          name: "Stranger fixture project",
        },
      });
      const strangerGoal = await prisma.learningGoal.create({
        data: {
          userId: stranger.id,
          projectId: strangerProject.id,
          title: "别人的目标",
        },
      });
      await expect(
        service.resetProfile({
          userId: owner.id,
          projectId: project.id,
          input: {
            scope: { kind: "goal", goalId: strangerGoal.id },
            reason: "越权重置",
            idempotencyKey: "p1b-reset-stranger",
          },
        })
      ).rejects.toMatchObject({ code: "not_found", status: 404 });
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });
});

describe("P1-D study packs", () => {
  async function setupStudyPackScenario() {
    const { owner, stranger, project } = await createFixture();
    const now = new Date("2026-08-01T08:00:00.000Z");
    const clock: LearningClock = { now: () => now };
    const sectionCalls: Array<{ title: string; key: string }> = [];
    const modelGateway: LearningModelGateway = {
      generateKnowledgeMap: async () => {
        throw new Error("not used");
      },
      generatePracticeItems: async () => {
        throw new Error("not used");
      },
      evaluateAttempt: async () => {
        throw new Error("not used");
      },
      async generateStudyPackSection(input) {
        const typed = input as {
          section: { title: string; key: string };
        };
        sectionCalls.push(typed.section);
        return {
          content: `# ${typed.section.title}\n\n## 核心要点\n- 依据资料生成的要点`,
        };
      },
    };
    const service = createLearningService({
      prisma,
      clock,
      ids: createIds(),
      modelGateway,
    });
    const suffix = randomUUID();
    const goal = await prisma.learningGoal.create({
      data: {
        userId: owner.id,
        projectId: project.id,
        title: "电路基础",
      },
    });
    const scope = await prisma.learningScope.create({
      data: {
        goalId: goal.id,
        version: 1,
        status: "confirmed",
        definition: { objective: "复习" },
        materialMode: "project_corpus",
        confirmedAt: now,
      },
    });
    const map = await prisma.knowledgeMap.create({
      data: {
        goalId: goal.id,
        scopeId: scope.id,
        version: 1,
        sourceFingerprint: "sha256:study-pack-map",
      },
    });
    const file = await prisma.fileAsset.create({
      data: {
        userId: owner.id,
        projectId: project.id,
        filename: "sp.md",
        originalName: "电路讲义.md",
        mimeType: "text/markdown",
        size: 32,
        storagePath: "integration/sp.md",
        textContent: "基尔霍夫电流定律：流入节点的电流等于流出节点的电流。",
        contentFingerprint: "sha256:sp-v1",
        status: "parsed",
      },
    });
    const anchor = await prisma.sourceAnchor.create({
      data: {
        projectId: project.id,
        anchorKey: `sp-anchor-${suffix}`,
        fileAssetId: file.id,
        originalFileAssetId: file.id,
        sourceFileName: file.originalName,
        locator: { kind: "file" },
        contentFingerprint: file.contentFingerprint!,
        excerptHash: "sha256:sp-excerpt",
      },
    });
    const pointLineage = await prisma.knowledgePointLineage.create({
      data: { goalId: goal.id, stableKey: `kcl-${suffix}` },
    });
    await prisma.knowledgePoint.create({
      data: {
        knowledgeMapId: map.id,
        lineageId: pointLineage.id,
        name: "节点电流定律",
        kind: "concept",
        orderIndex: 0,
        sourceLinks: { create: { sourceAnchorId: anchor.id } },
      },
    });
    return {
      owner,
      stranger,
      project,
      service,
      goal,
      map,
      getSectionCalls: () => sectionCalls,
    };
  }

  it("creates a draft from the map, updates and confirms the outline, then generates per section", async () => {
    const { owner, project, service, goal, map, getSectionCalls } =
      await setupStudyPackScenario();
    try {
      const created = await service.createStudyPackDraft({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: { idempotencyKey: "sp-create-1" },
      });
      expect(created.pack).toMatchObject({
        outlineStatus: "draft",
        sourceFingerprint: map.sourceFingerprint,
      });
      expect(created.pack.outline).toHaveLength(1);
      expect(created.pack.outline[0]).toMatchObject({
        title: "节点电流定律",
        description: null,
      });
      expect(created.pack.outline[0].key).toMatch(/^kcl-/);
      expect(created.pack.sections).toHaveLength(1);
      expect(created.pack.sections[0].status).toBe("draft");

      // 未确认大纲不能生成。
      await expect(
        service.generateStudyPack({
          userId: owner.id,
          projectId: project.id,
          packId: created.pack.id,
          input: { idempotencyKey: "sp-gen-1" },
        })
      ).rejects.toMatchObject({ code: "invalid_state", status: 409 });

      const updated = await service.updateStudyPackOutline({
        userId: owner.id,
        projectId: project.id,
        packId: created.pack.id,
        input: {
          outline: [
            {
              key: created.pack.sections[0].key,
              title: "节点电流定律（复习）",
              description: "重点复习",
            },
          ],
          status: "confirmed",
        },
      });
      expect(updated.pack.outlineStatus).toBe("confirmed");
      expect(updated.pack.sections[0].title).toBe("节点电流定律（复习）");

      // 确认后大纲结构锁定。
      await expect(
        service.updateStudyPackOutline({
          userId: owner.id,
          projectId: project.id,
          packId: created.pack.id,
          input: { outline: updated.pack.outline },
        })
      ).rejects.toMatchObject({ code: "invalid_state", status: 409 });

      const generated = await service.generateStudyPack({
        userId: owner.id,
        projectId: project.id,
        packId: created.pack.id,
        input: { idempotencyKey: "sp-gen-2" },
      });
      expect(generated.generated).toBe(1);
      expect(generated.pack.sections[0].status).toBe("ready");
      expect(generated.pack.sections[0].content).toContain("核心要点");
      expect(getSectionCalls()).toHaveLength(1);
      expect(getSectionCalls()[0].title).toBe("节点电流定律（复习）");

      // 再次生成是恢复操作：ready 节跳过。
      const resumed = await service.generateStudyPack({
        userId: owner.id,
        projectId: project.id,
        packId: created.pack.id,
        input: { idempotencyKey: "sp-gen-3" },
      });
      expect(resumed.generated).toBe(0);
      expect(resumed.skipped).toBe(1);
      expect(getSectionCalls()).toHaveLength(1);
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });

  it("keeps failed sections isolated, retries only the failed section, and preserves user edits", async () => {
    const { owner, project, service, goal, getSectionCalls } =
      await setupStudyPackScenario();
    try {
      const created = await service.createStudyPackDraft({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: { idempotencyKey: "sp-create-2" },
      });
      // 让第一节首次生成失败。
      const packWithFailure = await prisma.studyPackSection.update({
        where: { id: created.pack.sections[0].id },
        data: { status: "failed", failureReason: "模拟失败" },
      });
      expect(packWithFailure.status).toBe("failed");

      await service.updateStudyPackOutline({
        userId: owner.id,
        projectId: project.id,
        packId: created.pack.id,
        input: {
          outline: created.pack.outline,
          status: "confirmed",
        },
      });

      const regenerated = await service.regenerateStudyPackSection({
        userId: owner.id,
        projectId: project.id,
        packId: created.pack.id,
        sectionId: created.pack.sections[0].id,
        input: { idempotencyKey: "sp-regen-1" },
      });
      expect(regenerated.section.status).toBe("ready");
      expect(regenerated.section.failureReason).toBeNull();

      // 用户编辑优先于服务端内容，且不覆盖服务端版本。
      const edited = await service.saveStudyPackSection({
        userId: owner.id,
        projectId: project.id,
        packId: created.pack.id,
        sectionId: created.pack.sections[0].id,
        input: { content: "用户手写要点" },
      });
      expect(edited.section.userEdited).toBe(true);
      expect(edited.section.content).toBe("用户手写要点");

      const packDetail = await service.getStudyPack({
        userId: owner.id,
        projectId: project.id,
        packId: created.pack.id,
      });
      expect(packDetail.pack.sections[0].content).toBe("用户手写要点");

      // 重做单节：服务端版本更新，用户编辑版本保留。
      const redone = await service.regenerateStudyPackSection({
        userId: owner.id,
        projectId: project.id,
        packId: created.pack.id,
        sectionId: created.pack.sections[0].id,
        input: { idempotencyKey: "sp-regen-2" },
      });
      expect(redone.section.userEdited).toBe(true);
      expect(redone.section.content).toBe("用户手写要点");
      expect(getSectionCalls()).toHaveLength(2);
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });

  it("publishes a study pack as an artifact idempotently and rejects cross-tenant access", async () => {
    const { owner, stranger, project, service, goal } =
      await setupStudyPackScenario();
    try {
      const created = await service.createStudyPackDraft({
        userId: owner.id,
        projectId: project.id,
        goalId: goal.id,
        input: { idempotencyKey: "sp-create-3" },
      });
      const packId = created.pack.id;

      // 没有内容不能发布。
      await expect(
        service.publishStudyPack({
          userId: owner.id,
          projectId: project.id,
          packId,
          input: { idempotencyKey: "sp-publish-1" },
        })
      ).rejects.toMatchObject({ code: "invalid_state", status: 409 });

      await service.updateStudyPackOutline({
        userId: owner.id,
        projectId: project.id,
        packId,
        input: {
          outline: created.pack.outline,
          status: "confirmed",
        },
      });
      await service.generateStudyPack({
        userId: owner.id,
        projectId: project.id,
        packId,
        input: { idempotencyKey: "sp-gen-4" },
      });

      const published = await service.publishStudyPack({
        userId: owner.id,
        projectId: project.id,
        packId,
        input: { idempotencyKey: "sp-publish-2" },
      });
      expect(published.artifact.id).toBeTruthy();
      expect(published.pack.publishedArtifactId).toBe(published.artifact.id);
      const artifact = await prisma.artifact.findUnique({
        where: { id: published.artifact.id },
      });
      expect(artifact?.type).toBe("review_outline");
      expect(artifact?.content).toContain("核心要点");

      // 已发布再发布：返回同一成果（幂等）。
      const republished = await service.publishStudyPack({
        userId: owner.id,
        projectId: project.id,
        packId,
        input: { idempotencyKey: "sp-publish-3" },
      });
      expect(republished.artifact.id).toBe(published.artifact.id);

      await expect(
        service.getStudyPack({
          userId: stranger.id,
          projectId: project.id,
          packId,
        })
      ).rejects.toMatchObject({ code: "not_found", status: 404 });
      await expect(
        service.generateStudyPack({
          userId: stranger.id,
          projectId: project.id,
          packId,
          input: { idempotencyKey: "sp-gen-stranger" },
        })
      ).rejects.toMatchObject({ code: "not_found", status: 404 });
    } finally {
      await prisma.user.delete({ where: { id: owner.id } });
    }
  });
});
