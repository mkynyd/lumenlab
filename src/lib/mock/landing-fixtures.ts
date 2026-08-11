import type {
  AttemptResultDto,
  KnowledgeMapDto,
  LearningTodayGoalDto,
  PracticeItemClientDto,
} from "@/lib/hooks/use-learning-api";

/**
 * Landing page mock data. Kept entirely self-contained so the marketing
 * surface never reaches into Prisma, NextAuth, or the real learning APIs.
 * All copy and filenames are illustrative for the product
 * (光电效应, 现代物理, etc.) — change freely without breaking the
 * real workbench. Shapes mirror the public learning DTOs so the demos can
 * render real workbench components (KnowledgeMapView, PracticeItemCard,
 * PracticeFeedback, NextActionCard) without a backend.
 */

const DEMO_ANCHOR = {
  id: "anchor-1",
  fileAssetId: "file-1",
  locator: {},
  excerptHash: "demo",
} as const;

function anchors(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...DEMO_ANCHOR,
    id: `anchor-${index + 1}`,
  }));
}

/** 学习目标：首页演示共用的同一个目标。 */
export const MOCK_LEARNING_GOAL = {
  title: "大学物理 · 光电效应专项复习",
  purpose: "期末考前系统复盘光电效应一章，能独立推导并做对计算题。",
  targetDate: "2026-09-01",
  dailyMinutes: "45",
} as const;

/** 学习范围演示：勾选的资料与 AI 标出的资料缺口。 */
export const MOCK_LEARNING_SCOPE = {
  files: [
    { id: "f1", name: "lecture-03-photoelectric.pdf", pages: "24 页" },
    { id: "f2", name: "experiment-manual.pdf", pages: "12 页" },
    { id: "f3", name: "homework-08.pdf", pages: "6 页" },
  ],
  gaps: ["往年试题", "课堂板书照片"],
} as const;

/** 知识点地图：直接喂给真实 KnowledgeMapView 组件。 */
export const MOCK_LEARNING_MAP: KnowledgeMapDto = {
  id: "map-demo",
  goalId: "goal-demo",
  scopeId: "scope-demo",
  version: 1,
  sourceFingerprint: "demo-fingerprint",
  createdAt: "2026-08-11T09:00:00+08:00",
  points: [
    {
      id: "kp-1",
      lineageId: "kpl-1",
      stableKey: "photoelectric-laws",
      name: "光电效应的实验规律",
      kind: "concept",
      orderIndex: 0,
      freshness: "current",
      sourceAnchors: anchors(2),
    },
    {
      id: "kp-2",
      lineageId: "kpl-2",
      stableKey: "einstein-equation",
      name: "爱因斯坦光电方程",
      kind: "concept",
      orderIndex: 1,
      freshness: "current",
      sourceAnchors: anchors(2),
    },
    {
      id: "kp-3",
      lineageId: "kpl-3",
      stableKey: "cutoff-frequency",
      name: "截止频率与逸出功",
      kind: "fact",
      orderIndex: 2,
      freshness: "current",
      sourceAnchors: anchors(1),
    },
    {
      id: "kp-4",
      lineageId: "kpl-4",
      stableKey: "uncertainty",
      name: "误差来源与不确定度合成",
      kind: "procedure",
      orderIndex: 3,
      freshness: "current",
      sourceAnchors: anchors(2),
    },
    {
      id: "kp-5",
      lineageId: "kpl-5",
      stableKey: "data-fitting",
      name: "实验数据处理与拟合",
      kind: "skill",
      orderIndex: 4,
      freshness: "needs_revalidation",
      sourceAnchors: anchors(1),
    },
  ],
};

/** 诊断练习题：直接喂给真实 PracticeItemCard 组件。 */
export const MOCK_PRACTICE_ITEM: PracticeItemClientDto = {
  id: "item-demo",
  lineageId: "item-lineage-demo",
  version: 1,
  prompt: "保持入射光强不变、只增大入射光频率时，逸出光电子的最大初动能如何变化？",
  type: "single_choice",
  options: [
    { id: "opt-a", label: "增大" },
    { id: "opt-b", label: "减小" },
    { id: "opt-c", label: "不变" },
    { id: "opt-d", label: "取决于金属种类" },
  ],
  mode: "evidence_bearing",
  freshness: "current",
  sourceAnchors: anchors(2),
};

/** 提交后的判定与解析：直接喂给真实 PracticeFeedback 组件。 */
export const MOCK_ATTEMPT_RESULT: AttemptResultDto = {
  attempt: {
    id: "attempt-demo",
    sessionItemId: "session-item-demo",
    answer: "opt-a",
    assistanceLevel: "independent",
    spacingSeconds: 0,
    submittedAt: "2026-08-11T09:30:00+08:00",
  },
  evaluation: {
    id: "eval-demo",
    attemptId: "attempt-demo",
    verdict: "correct",
    score: 1,
    rubric: null,
    confidence: 0.98,
    errorType: null,
    reason: "selected_option_matches",
    policyVersion: "demo",
    createdAt: "2026-08-11T09:30:05+08:00",
  },
  progress: [],
  feedback: {
    practiceItem: MOCK_PRACTICE_ITEM,
    explanation:
      "由爱因斯坦光电方程 E = hν − W，频率 ν 越大，光电子的最大初动能越大；光强只影响单位时间逸出的光电子数量，不改变单个光电子的能量。",
  },
};

/** Today 下一步：直接喂给真实 NextActionCard 组件。 */
export const MOCK_LEARNING_TODAY: LearningTodayGoalDto = {
  goal: {
    id: "goal-demo",
    projectId: "project-demo",
    title: MOCK_LEARNING_GOAL.title,
    purpose: MOCK_LEARNING_GOAL.purpose,
    targetDate: "2026-09-01T00:00:00+08:00",
    dailyMinutes: 45,
    status: "active",
    createdAt: "2026-08-01T10:00:00+08:00",
    updatedAt: "2026-08-11T09:00:00+08:00",
  },
  project: { id: "project-demo", name: "光电效应实验复盘" },
  summary: {
    total: 5,
    new: 1,
    learning: 3,
    mastered: 1,
    due: 3,
    needsRevalidation: 1,
    unsupported: 0,
  },
  nextAction: { type: "review", href: "/register", dueCount: 3 },
};

/** 到期复习队列演示（行视觉复刻真实 ReviewQueue）。 */
export const MOCK_REVIEW_DUE = [
  { id: "due-1", name: "截止频率与逸出功", mastery: "learning" },
  { id: "due-2", name: "误差来源与不确定度合成", mastery: "learning" },
  { id: "due-3", name: "爱因斯坦光电方程", mastery: "mastered" },
] as const;

/** 错题与资料包演示。 */
export const MOCK_WRONG_ANSWERS = {
  unresolved: 2,
  sample: "用逸出功 W 表示截止频率 ν₀ 时写反了两者的比值方向",
} as const;

export const MOCK_STUDY_PACK = {
  title: "光电效应 · 考前复习包",
  sectionCount: 6,
} as const;
