import { type FileCategory } from "@/lib/file-categories";

/**
 * Landing page mock data. Kept entirely self-contained so the marketing
 * surface never reaches into Prisma, NextAuth, or the real chat/project
 * APIs. All copy and filenames are illustrative for the product
 * (光电效应, 现代物理, etc.) — change freely without breaking the
 * real workbench.
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

export const MOCK_HOW_TO_STEPS = [
  {
    index: 1,
    title: "克隆仓库并安装依赖",
    description: "项目使用 pnpm 管理依赖；Node 版本要求 ≥ 20。",
    command: "pnpm install",
    note: "需要先在 .env 中配置 DATABASE_URL 和 ANTHROPIC_API_KEY。",
  },
  {
    index: 2,
    title: "初始化数据库并启动开发服务",
    description: "迁移 Prisma schema，启动 Next.js 开发服务器。",
    command: "pnpm prisma migrate dev && pnpm dev",
    note: "首次运行会自动建表；启动后访问 http://localhost:3000。",
  },
  {
    index: 3,
    title: "注册并创建第一个项目",
    description: "在登录页使用注册码开通账号，进入「项目空间」新建项目。",
    command: "pnpm dlx tsx scripts/issue-registration-code.ts",
    note: "Alpha 阶段账号通过注册码开通；运行上面的命令可以现场签发一个。",
  },
] as const;
