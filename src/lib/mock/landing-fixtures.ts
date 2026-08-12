import type {
  AttemptResultDto,
  KnowledgeMapDto,
  LearningTodayGoalDto,
  PracticeItemClientDto,
} from "@/lib/hooks/use-learning-api";
import { type FileCategory } from "@/lib/file-categories";

/**
 * Landing page mock data. Kept entirely self-contained so the marketing
 * surface never reaches into Prisma, NextAuth, or the real chat/project/
 * learning APIs. All copy and filenames are illustrative for the product
 * (光电效应, 现代物理, etc.) — change freely without breaking the
 * real workbench. Learning shapes mirror the public learning DTOs so the
 * demos can render real workbench components (KnowledgeMapView,
 * PracticeItemCard, PracticeFeedback, NextActionCard) without a backend.
 */

export type MockChatRole = "user" | "assistant";

export interface MockChatMessage {
  id: string;
  role: MockChatRole;
  content: string;
  reasoningContent?: string;
  tokenCount: number;
  hasReasoningCollapsed?: boolean;
}

export const MOCK_CHAT_MESSAGES: MockChatMessage[] = [
  {
    id: "u1",
    role: "user",
    content: "请帮我整理这次光电效应实验的误差分析思路，并给出一个复习提纲。",
    tokenCount: 24,
  },
  {
    id: "a1",
    role: "assistant",
    reasoningContent:
      "用户在准备实验复盘，且明确要求两件事：误差分析 + 复习提纲。应该先按误差源拆，再合成到提纲。",
    content: `## 误差分析的三条主线

1. **系统误差**：仪器零点偏移、单色仪带宽引入的 $\\Delta\\lambda$。
2. **随机误差**：暗电流涨落、读数估读、多次拟合的离散度。
3. **粗大误差**：饱和反向电压附近数据抖动，需要剔除。

把三类误差合成不确定度后，再用 $\\nu_0 = c/\\lambda_c$ 推出截止频率的置信区间。

\`\`\`python
import numpy as np
uc = np.sqrt(u_sys**2 + u_rand**2)
print(f"截止频率 = {nu0:.3e} ± {uc:.1e} Hz")
\`\`\`

> 提纲会自动落到右侧"复习"标签页。`,
    tokenCount: 312,
    hasReasoningCollapsed: true,
  },
  {
    id: "u2",
    role: "user",
    content: "把误差分析里讲到的截止频率置信区间再算一遍，用实验数据。",
    tokenCount: 18,
  },
  {
    id: "a2",
    role: "assistant",
    content: `已读取 \`exp-data-raw.csv\` 中 6 组 $\\lambda_c$ 数据：

| 序号 | $\\lambda_c$ / nm | $u(\\lambda_c)$ / nm |
|---|---|---|
| 1 | 612.4 | 3.1 |
| 2 | 610.9 | 2.8 |
| 3 | 614.1 | 3.0 |
| 4 | 611.7 | 2.9 |
| 5 | 613.2 | 3.2 |
| 6 | 612.0 | 2.9 |

合成后 $\\bar{\\lambda}_c = 612.4 \\pm 1.0~\\text{nm}$，对应截止频率 $\\nu_0 = (4.896 \\pm 0.008)\\times 10^{14}~\\text{Hz}$，落在教材给出的 $4.89\\!-\!4.91\\times 10^{14}$ 区间内。`,
    tokenCount: 218,
  },
];

export interface MockProjectFile {
  id: string;
  name: string;
  category: FileCategory;
  size: string;
  status: "ready" | "parsing" | "error";
  pageCount?: number;
}

export interface MockProject {
  name: string;
  type: string;
  description: string;
  conversationCount: number;
  artifactCount: number;
  files: MockProjectFile[];
}

export const MOCK_PROJECT: MockProject = {
  name: "光电效应实验复盘",
  type: "实验工作台",
  description: "从原始数据到误差分析、复习提纲的完整复盘流程。",
  conversationCount: 6,
  artifactCount: 12,
  files: [
    {
      id: "f1",
      name: "lecture-03-photoelectric.pdf",
      category: "讲义",
      size: "2.4 MB",
      status: "ready",
      pageCount: 24,
    },
    {
      id: "f2",
      name: "experiment-manual.pdf",
      category: "讲义",
      size: "1.1 MB",
      status: "ready",
      pageCount: 12,
    },
    {
      id: "f3",
      name: "exp-data-raw.csv",
      category: "实验",
      size: "8.6 KB",
      status: "ready",
    },
    {
      id: "f4",
      name: "fitting.py",
      category: "代码",
      size: "1.2 KB",
      status: "ready",
    },
    {
      id: "f5",
      name: "review-outline.md",
      category: "讲义",
      size: "4.0 KB",
      status: "parsing",
    },
    {
      id: "f6",
      name: "homework-08.pdf",
      category: "作业",
      size: "0.9 MB",
      status: "ready",
      pageCount: 6,
    },
  ],
};

export const MOCK_CONVERSION = {
  title: "现代物理 · 第三章",
  originalName: "modern-physics-ch3.pdf",
  pageCount: 24,
  fileSize: "8.4 MB",
  createdAt: "2026 年 6 月 22 日 14:30",
  stages: [
    { key: "uploading", label: "上传", done: true },
    { key: "pending", label: "排队", done: true },
    { key: "model", label: "解析", done: true },
    { key: "done", label: "完成", done: true },
  ] as Array<{ key: string; label: string; done: boolean }>,
  markdownSample: `## 3.1 光电效应的实验规律

当光照射到金属表面时，金属内的自由电子会吸收光子能量并逸出。这一现象最早由 Hertz 在 1887 年观察到。

### 关键实验结论

- 存在截止频率 $\\nu_0$：入射光频率低于 $\\nu_0$ 时，无论光强多大，都不会产生光电子。
- 光电子的最大初动能与光强无关，只取决于频率：$E_{\\max} = h\\nu - W$。
- 光电子的发射几乎是瞬时的（$< 10^{-9}~\\text{s}$）。

### 爱因斯坦的光量子解释

把光看成由能量为 $h\\nu$ 的光子组成，每个电子吸收一个光子后克服金属的逸出功 $W$ 逸出：

$$
h\\nu = W + \\frac{1}{2} m_e v_{\\max}^2
$$

> 这一关系给出了 $h$ 的精确测量方法——它正是 Millikan 实验的核心。`,
};

/**
 * 首页「三步建项目」演示的静态数据：复刻 /projects/new 表单（步骤 1 + 步骤 4），
 * 不接 API / SSE；和真实页面共用同一组视觉 token。
 */
export const MOCK_NEW_PROJECT = {
  name: "光电效应实验复盘",
  type: "experiment",
  sceneDescription:
    "我是大二物理专业学生，想把这次光电效应实验的数据、误差源和复习提纲整理到一处，复习前能快速调出。",
  generatedPrompt: `# 项目背景

你是为光电效应实验复盘而设的项目助手。

# 任务范围

- 解读实验数据 CSV 与原始讲义。
- 推导截止频率与不确定度区间。
- 生成可背诵的复习提纲。

# 输出约束

- 公式一律用 KaTeX。
- 引用过的段落必须标注文献来源。
- 复习提纲按考点拆条，不写空话。`,
  quickActions: [
    { title: "误差分析思路", prompt: "按系统 / 随机 / 粗大三类误差拆解，给出本次实验的不确定度合成思路。" },
    { title: "复习提纲生成", prompt: "根据讲义与本次数据，整理一份按考点拆条的复习提纲，输出 Markdown。" },
    { title: "截止频率计算", prompt: "读取原始 CSV 数据，复算 λ_c，给出 ν_0 的置信区间。" },
  ],
} as const;

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
