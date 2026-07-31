/**
 * Shared Wave 2A test fixtures. All shapes mirror the actual learning
 * service responses (see `src/lib/hooks/use-learning-api.ts`).
 *
 * These fixtures intentionally contain NO answerCriteria and NO
 * generationMetadata anywhere: session/item payloads are pre-submit public
 * DTOs. `explanation` appears only inside post-submit feedback fixtures
 * (attempt result / answer exposure / wrong-answer items), mirroring the
 * frozen contract.
 */

import type {
  AnswerExposureResultDto,
  AttemptEvaluationDto,
  AttemptResultDto,
  HintResultDto,
  KnowledgeMapDto,
  LearningGoalDto,
  LearningProgressPointDto,
  LearningProgressResponse,
  LearningProgressSummaryDto,
  LearningScopeDto,
  LearningSessionClientDto,
  LearningTodayResponse,
  PracticeItemClientDto,
  ReviewEntryDto,
  ReviewListResponse,
  WrongAnswerItemDto,
  WrongAnswerListResponse,
} from "@/lib/hooks/use-learning-api";

export const NOW = "2026-07-31T08:00:00.000Z";

export const fixtureGoal: LearningGoalDto = {
  id: "goal-1",
  projectId: "project-1",
  title: "数据结构期末复习",
  purpose: "两周后期末考试",
  targetDate: "2026-08-14T00:00:00.000Z",
  dailyMinutes: 45,
  status: "active",
  createdAt: "2026-07-30T08:00:00.000Z",
  updatedAt: "2026-07-30T08:00:00.000Z",
};

export const fixtureScopeDraft: LearningScopeDto = {
  id: "scope-1",
  goalId: "goal-1",
  version: 1,
  status: "draft",
  definition: { focus: "树与图" },
  materialMode: "project_corpus",
  fileIds: [],
  materialGaps: ["缺少第 7 章讲义"],
  confirmedAt: null,
  createdAt: "2026-07-30T08:05:00.000Z",
};

export const fixtureScopeConfirmed: LearningScopeDto = {
  ...fixtureScopeDraft,
  status: "confirmed",
  confirmedAt: "2026-07-30T08:10:00.000Z",
};

export const fixtureKnowledgeMap: KnowledgeMapDto = {
  id: "map-1",
  goalId: "goal-1",
  scopeId: "scope-1",
  version: 1,
  sourceFingerprint: "sha256:map",
  createdAt: "2026-07-30T08:20:00.000Z",
  points: [
    {
      id: "kp-1",
      lineageId: "lineage-1",
      stableKey: "binary-tree",
      name: "二叉树遍历",
      kind: "concept",
      orderIndex: 0,
      freshness: "current",
      sourceAnchors: [
        {
          id: "anchor-1",
          fileAssetId: "file-1",
          locator: { kind: "file" },
          excerptHash: "sha256:a",
        },
      ],
    },
    {
      id: "kp-2",
      lineageId: "lineage-2",
      stableKey: "graph-traversal",
      name: "图的遍历",
      kind: "concept",
      orderIndex: 1,
      freshness: "needs_revalidation",
      sourceAnchors: [
        {
          id: "anchor-2",
          fileAssetId: "file-2",
          locator: { kind: "file" },
          excerptHash: "sha256:b",
        },
      ],
    },
    {
      id: "kp-3",
      lineageId: "lineage-3",
      stableKey: "sorting",
      name: "排序算法复杂度",
      kind: "skill",
      orderIndex: 2,
      freshness: "unsupported",
      sourceAnchors: [],
    },
  ],
};

export function fixturePracticeItem(
  overrides: Partial<PracticeItemClientDto> = {}
): PracticeItemClientDto {
  return {
    id: "item-1",
    lineageId: "item-lineage-1",
    version: 1,
    prompt: "二叉树的中序遍历结果是什么？",
    type: "single_choice",
    mode: "evidence_bearing",
    freshness: "current",
    options: [
      { id: "opt-a", label: "左根右" },
      { id: "opt-b", label: "根左右" },
    ],
    sourceAnchors: [
      {
        id: "anchor-1",
        fileAssetId: "file-1",
        locator: { kind: "file" },
        excerptHash: "sha256:a",
      },
    ],
    ...overrides,
  };
}

export const fixtureSession: LearningSessionClientDto = {
  id: "session-1",
  goalId: "goal-1",
  knowledgeMapId: "map-1",
  mode: "diagnostic",
  status: "ready",
  startedAt: null,
  completedAt: null,
  createdAt: "2026-07-30T08:30:00.000Z",
  items: [
    {
      id: "session-item-1",
      orderIndex: 0,
      status: "pending",
      practiceItem: fixturePracticeItem(),
    },
    {
      id: "session-item-2",
      orderIndex: 1,
      status: "pending",
      practiceItem: fixturePracticeItem({
        id: "item-2",
        lineageId: "item-lineage-2",
        prompt: "以下哪些是图的遍历方式？",
        type: "multiple_choice",
        options: [
          { id: "opt-a", label: "深度优先" },
          { id: "opt-b", label: "广度优先" },
          { id: "opt-c", label: "中序优先" },
        ],
      }),
    },
    {
      id: "session-item-3",
      orderIndex: 2,
      status: "pending",
      practiceItem: fixturePracticeItem({
        id: "item-3",
        lineageId: "item-lineage-3",
        prompt: "快速排序最坏情况时间复杂度是 O(n^2)。",
        type: "true_false",
        options: null,
      }),
    },
    {
      id: "session-item-4",
      orderIndex: 3,
      status: "pending",
      practiceItem: fixturePracticeItem({
        id: "item-4",
        lineageId: "item-lineage-4",
        prompt: "10 个元素的二叉堆高度是多少？",
        type: "numeric",
        options: null,
      }),
    },
    {
      id: "session-item-5",
      orderIndex: 4,
      status: "pending",
      practiceItem: fixturePracticeItem({
        id: "item-5",
        lineageId: "item-lineage-5",
        prompt: "简述平衡二叉树的旋转条件。",
        type: "short_answer",
        options: null,
      }),
    },
    {
      id: "session-item-6",
      orderIndex: 5,
      status: "pending",
      practiceItem: fixturePracticeItem({
        id: "item-6",
        lineageId: "item-lineage-6",
        prompt: "设计一个支持范围查询的树结构并说明权衡。",
        type: "open_design",
        mode: "feedback_only",
        options: null,
      }),
    },
  ],
};

export const fixtureEvaluation: AttemptEvaluationDto = {
  id: "evaluation-1",
  attemptId: "attempt-1",
  verdict: "incorrect",
  score: 0,
  rubric: null,
  confidence: 0.92,
  errorType: "misconception",
  reason: "中序遍历先访问左子树，再访问根。",
  policyVersion: "learning-grading-v1",
  createdAt: NOW,
};

export const fixtureAttemptResult: AttemptResultDto = {
  attempt: {
    id: "attempt-1",
    sessionItemId: "session-item-1",
    answer: "opt-b",
    assistanceLevel: "independent",
    spacingSeconds: 0,
    submittedAt: NOW,
  },
  evaluation: fixtureEvaluation,
  progress: [],
  feedback: {
    practiceItem: fixturePracticeItem({ options: null }),
    explanation: "中序遍历顺序为左-根-右，因此结果为左根右。",
  },
};

export const fixtureHintResult: HintResultDto = {
  interaction: {
    id: "interaction-1",
    sessionItemId: "session-item-1",
    type: "hint_revealed",
    createdAt: NOW,
  },
  hint: "先明确题目对应的知识点，再沿资料锚点回看定义。",
};

export const fixtureAnswerExposure: AnswerExposureResultDto = {
  interaction: {
    id: "interaction-2",
    sessionItemId: "session-item-1",
    type: "answer_revealed",
    createdAt: NOW,
  },
  feedback: {
    practiceItem: fixturePracticeItem({ options: null }),
    explanation: "中序遍历顺序为左-根-右，因此结果为左根右。",
  },
};

export function fixtureProgressPoint(
  overrides: Partial<LearningProgressPointDto> = {}
): LearningProgressPointDto {
  return {
    id: "progress-1",
    lineageId: "lineage-1",
    knowledgePointId: "kp-1",
    name: "二叉树遍历",
    masteryState: "mastered",
    historicalMasteryState: "mastered",
    freshness: "current",
    nextReviewAt: "2026-07-30T08:00:00.000Z",
    reviewState: "due",
    policyVersion: "progress-v1",
    evidenceAsOf: NOW,
    ...overrides,
  };
}

export const fixtureProgressSummary: LearningProgressSummaryDto = {
  total: 20,
  new: 10,
  learning: 7,
  mastered: 3,
  due: 4,
  needsRevalidation: 2,
  unsupported: 1,
};

export const fixtureProgressResponse: LearningProgressResponse = {
  summary: fixtureProgressSummary,
  points: [
    fixtureProgressPoint(),
    fixtureProgressPoint({
      id: "progress-2",
      lineageId: "lineage-2",
      knowledgePointId: "kp-2",
      name: "图的遍历",
      masteryState: "learning",
      historicalMasteryState: "learning",
      freshness: "needs_revalidation",
      nextReviewAt: "2026-07-31T07:00:00.000Z",
    }),
    fixtureProgressPoint({
      id: "progress-3",
      lineageId: "lineage-3",
      knowledgePointId: "kp-3",
      name: "排序算法复杂度",
      masteryState: "new",
      historicalMasteryState: "new",
      nextReviewAt: null,
      reviewState: "unscheduled",
      evidenceAsOf: null,
    }),
  ],
};

export const fixtureReviewEntries: ReviewEntryDto[] = [
  { ...fixtureProgressPoint(), reviewState: "due" },
  {
    ...fixtureProgressPoint({
      id: "progress-2",
      lineageId: "lineage-2",
      knowledgePointId: "kp-2",
      name: "图的遍历",
      masteryState: "learning",
      historicalMasteryState: "learning",
      freshness: "needs_revalidation",
      nextReviewAt: "2026-07-31T07:00:00.000Z",
    }),
    reviewState: "due",
  },
];

export const fixtureReviewList: ReviewListResponse = {
  reviews: fixtureReviewEntries,
};

export const fixtureWrongAnswerItems: WrongAnswerItemDto[] = [
  {
    policyVersion: "wrong-answer-v1",
    itemLineageId: "item-lineage-1",
    status: "unresolved",
    latestVerdict: "incorrect",
    triggeringAttemptIds: ["attempt-1"],
    resolutionAttemptIds: [],
    feedback: {
      practiceItem: fixturePracticeItem({ options: null }),
      explanation: "中序遍历顺序为左-根-右。",
    },
    knowledgePoints: [
      { id: "kp-1", lineageId: "lineage-1", name: "二叉树遍历" },
    ],
    attempts: [
      {
        id: "attempt-1",
        answer: "opt-b",
        assistanceLevel: "independent",
        spacingSeconds: 0,
        submittedAt: NOW,
        evaluations: [fixtureEvaluation],
      },
    ],
    progress: [fixtureProgressPoint()],
  },
  {
    policyVersion: "wrong-answer-v1",
    itemLineageId: "item-lineage-4",
    status: "resolved",
    latestVerdict: "partial",
    triggeringAttemptIds: ["attempt-2"],
    resolutionAttemptIds: ["attempt-4"],
    feedback: {
      practiceItem: fixturePracticeItem({
        id: "item-4",
        lineageId: "item-lineage-4",
        prompt: "10 个元素的二叉堆高度是多少？",
        type: "numeric",
        options: null,
      }),
      explanation: "高度为 floor(log2(n)) + 1。",
    },
    knowledgePoints: [
      { id: "kp-3", lineageId: "lineage-3", name: "排序算法复杂度" },
    ],
    attempts: [
      {
        id: "attempt-2",
        answer: 3,
        assistanceLevel: "hinted",
        spacingSeconds: 0,
        submittedAt: "2026-07-29T08:00:00.000Z",
        evaluations: [
          {
            ...fixtureEvaluation,
            id: "evaluation-2",
            attemptId: "attempt-2",
            verdict: "partial",
            errorType: "calculation_or_operation",
            reason: "公式正确，代入错误。",
          },
        ],
      },
      {
        id: "attempt-4",
        answer: 4,
        assistanceLevel: "independent",
        spacingSeconds: 172800,
        submittedAt: NOW,
        evaluations: [
          {
            ...fixtureEvaluation,
            id: "evaluation-4",
            attemptId: "attempt-4",
            verdict: "correct",
            score: 1,
            errorType: null,
            reason: "回答正确。",
          },
        ],
      },
    ],
    progress: [
      fixtureProgressPoint({
        lineageId: "lineage-3",
        knowledgePointId: "kp-3",
        name: "排序算法复杂度",
        masteryState: "learning",
        historicalMasteryState: "learning",
      }),
    ],
  },
];

export const fixtureWrongAnswerList: WrongAnswerListResponse = {
  items: fixtureWrongAnswerItems,
};

export const fixtureToday: LearningTodayResponse = {
  asOf: NOW,
  goals: [
    {
      goal: fixtureGoal,
      project: { id: "project-1", name: "数据结构" },
      summary: fixtureProgressSummary,
      nextAction: {
        type: "review",
        href: "/learning?project=project-1&goal=goal-1&step=review",
        dueCount: 4,
      },
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Answer-leak guard helpers                                            */
/* ------------------------------------------------------------------ */

/** Field names that must never appear in pre-submit client data. */
export const SENSITIVE_LEARNING_FIELDS = [
  "answerCriteria",
  "generationMetadata",
] as const;

/** Recursively assert a value contains no sensitive pre-submit fields. */
export function expectNoSensitiveFields(value: unknown) {
  const serialized = JSON.stringify(value) ?? "";
  for (const field of SENSITIVE_LEARNING_FIELDS) {
    if (serialized.includes(`"${field}"`)) {
      throw new Error(`Sensitive learning field leaked into client data: ${field}`);
    }
  }
}
