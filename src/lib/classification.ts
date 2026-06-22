/**
 * User Role Classification — 动态分类 Prompt 构建 + 提示词拼接。
 *
 * 架构：
 *   数据库 UserRole 表 = 运行时事实源
 *   prisma/seeds/user-roles.json = 首次初始化种子
 *   DeepSeek 输出受 JSON Schema 约束，roleKey 必须来自动态枚举
 */

import { prisma } from "@/lib/db";
import { GLOBAL_SYSTEM_PROMPT, GLOBAL_SYSTEM_PROMPT_WEB_SEARCH, getModePrompt } from "@/lib/ai/prompts";

// ============================================================
// 类型
// ============================================================

export interface ClassifierHints {
  keywords: string[];
  positiveExamples: string[];
  negativeExamples: string[];
  priorityBoost: number;
}

export interface ClassificationResult {
  roleKey: string | null;
  mode: "experiment" | "review" | "coding" | "general";
  domain: string;
  confidence: number;
  reason: string;
}

export interface QuickActionRecommendation {
  title: string;
  prompt: string;
}

// ============================================================
// 动态构建分类 Prompt
// ============================================================

export async function buildClassificationPrompt(
  mode: string
): Promise<{
  systemPrompt: string;
  jsonSchema: Record<string, unknown>;
  roleKeys: string[];
}> {
  const roles = await prisma.userRole.findMany({
    where: {
      isActive: true,
      applicableModes: { has: mode },
    },
    select: {
      key: true,
      label: true,
      description: true,
      classifierHints: true,
    },
    orderBy: { priority: "desc" },
  });

  const roleKeys = roles.map((r) => r.key);

  const roleListText = roles
    .map((r) => {
      const hints = r.classifierHints as ClassifierHints;
      const kw = hints.keywords.join("、");
      const pos = hints.positiveExamples.join("；");
      const neg =
        hints.negativeExamples.length > 0
          ? hints.negativeExamples.join("；")
          : "无";
      return `- key: "${r.key}" | 标签: ${r.label} | ${r.description || ""}
  匹配关键词: ${kw}
  正例: ${pos}
  反例: ${neg}`;
    })
    .join("\n");

  const systemPrompt = `你是一个用户分类助手。根据用户输入的自然语言（专业/职业描述、使用目的），判断最匹配的身份角色和工作模式。

可用角色（只能从中选择，如果都不匹配则 roleKey 为 null）：
${roleListText}

工作模式：
- experiment: 实验操作、实践任务、数据处理、图形绘制
- review: 复习备考、资料整理、知识点总结、试卷分析
- coding: 编程开发、代码调试、算法分析
- general: 通用问答、创作、或其他无法归入以上三类的任务

输出要求：
- roleKey 必须从上述可用角色的 key 中精确选择，无匹配则为 null
- mode 根据用户的使用目的选择最合适的工作模式
- domain 用中文写出具体学科/专业领域
- 用户描述可能模糊，尽可能推断最合理的分类`;

  const schema = {
    type: "object",
    properties: {
      roleKey: {
        type: "string",
        enum: [...roleKeys, null],
        description: "从可用角色列表中选择最匹配的 key，无匹配则为 null",
      },
      mode: {
        type: "string",
        enum: ["experiment", "review", "coding", "general"],
        description: "项目工作模式",
      },
      domain: {
        type: "string",
        description: "专业/学科领域",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "分类置信度，仅日志使用",
      },
      reason: {
        type: "string",
        maxLength: 200,
        description: "分类理由，仅日志使用",
      },
    },
    required: ["roleKey", "mode", "domain", "confidence", "reason"],
    additionalProperties: false,
  };

  return { systemPrompt, jsonSchema: schema, roleKeys };
}

// ============================================================
// 获取快捷任务推荐
// ============================================================

export async function getRecommendedQuickActions(
  roleKey: string | null
): Promise<QuickActionRecommendation[]> {
  if (!roleKey) {
    return [
      { title: "资料总结", prompt: "请提炼以下资料的核心要点" },
      { title: "知识点梳理", prompt: "请梳理以下内容的知识框架" },
    ];
  }

  const role = await prisma.userRole.findUnique({ where: { key: roleKey } });
  if (!role?.recommendedQuickActions) return [];

  const actions = role.recommendedQuickActions as QuickActionRecommendation[];
  return Array.isArray(actions) ? actions : [];
}

// ============================================================
// 提示词拼接器
// ============================================================

export interface PromptAssemblyInput {
  webSearchActive: boolean;
  projectId?: string;
  userId?: string;
  mode?: string;
}

export async function assembleSystemPrompt(
  input: PromptAssemblyInput
): Promise<string> {
  const parts: string[] = [];

  // Layer 1: Global prompt (with or without web search)
  parts.push(
    input.webSearchActive ? GLOBAL_SYSTEM_PROMPT_WEB_SEARCH : GLOBAL_SYSTEM_PROMPT
  );

  // Layer 2: Identity injection
  let identityText = "";

  // 2a: Global UserProfileRole (设置页"关于你"的主角色)
  if (input.userId) {
    const primaryProfileRole = await prisma.userProfileRole.findFirst({
      where: { userId: input.userId, isPrimary: true },
      include: { role: { select: { systemPromptAddition: true } } },
    });
    if (primaryProfileRole?.role.systemPromptAddition) {
      identityText += primaryProfileRole.role.systemPromptAddition + "\n";
    }
  }

  // 2b: Project-level ProjectRole (覆盖全局)
  if (input.projectId) {
    const projectRole = await prisma.projectRole.findFirst({
      where: { projectId: input.projectId, isActive: true },
      include: { role: { select: { systemPromptAddition: true } } },
    });
    if (projectRole?.role.systemPromptAddition) {
      identityText += projectRole.role.systemPromptAddition + "\n";
    }
  }

  if (identityText.trim()) {
    parts.push(`## 用户身份\n${identityText.trim()}`);
  }

  // Layer 3: Mode-specific prompt
  const mode = input.mode || "general";
  const modePrompt = getModePrompt(mode);
  if (modePrompt) {
    parts.push(modePrompt);
  }

  return parts.join("\n\n");
}

// ============================================================
// 种子数据导入（由 prisma/seed.ts 调用）
// ============================================================

import fs from "node:fs";
import path from "node:path";

interface SeedRole {
  key: string;
  label: string;
  description?: string;
  applicableModes: string[];
  classifierHints: ClassifierHints;
  systemPromptAddition: string;
  recommendedQuickActions?: QuickActionRecommendation[];
  priority: number;
  isActive: boolean;
}

export async function seedUserRoles(seedPath?: string): Promise<number> {
  const filePath =
    seedPath ||
    path.join(process.cwd(), "prisma/seeds/user-roles.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const roles: SeedRole[] = JSON.parse(raw);

  let count = 0;
  for (const role of roles) {
    await prisma.userRole.upsert({
      where: { key: role.key },
      create: {
        key: role.key,
        label: role.label,
        description: role.description,
        applicableModes: role.applicableModes,
        classifierHints: role.classifierHints,
        systemPromptAddition: role.systemPromptAddition,
        recommendedQuickActions: role.recommendedQuickActions,
        priority: role.priority,
        isActive: role.isActive,
      },
      update: {
        label: role.label,
        description: role.description,
        applicableModes: role.applicableModes,
        classifierHints: role.classifierHints,
        systemPromptAddition: role.systemPromptAddition,
        recommendedQuickActions: role.recommendedQuickActions,
        priority: role.priority,
        isActive: role.isActive,
        version: { increment: 1 },
      },
    });
    count++;
  }
  return count;
}
