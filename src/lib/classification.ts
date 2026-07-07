/**
 * 简化的提示词拼接器。
 *
 * 架构变更：
 *   不再维护 UserRole 数据库体系。
 *   项目级 systemPrompt 由 LLM 根据用户自然语言输入生成，存入 Project.systemPrompt。
 *   用户全局 profilePrompt 存入 User.profilePrompt。
 *
 * 拼接顺序：GLOBAL → userProfilePrompt → projectSystemPrompt → MODE_PROMPT
 */

import { prisma } from "@/lib/db";
import { GLOBAL_SYSTEM_PROMPT, GLOBAL_SYSTEM_PROMPT_WEB_SEARCH, getModePrompt } from "@/lib/ai/prompts";
import {
  renderUserProfilePrompt,
  renderProjectPrompt,
  USER_PROFILE_SCHEMA_JSON,
  PROJECT_PROMPT_SCHEMA_JSON,
  type UserProfileSchema,
  type ProjectPromptSchema,
} from "@/lib/ai/profile-schemas";
import { skillRegistry } from "@/lib/agent/skill-registry";

// ============================================================
// LLM 生成项目级 Prompt
// ============================================================

export async function generateProjectPrompt(
  userInput: string,
  mode: string,
  apiKey: string
): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const { mapDeepSeekModel } = await import("@/lib/deepseek");

  const modeLabel =
    mode === "experiment" ? "实验/实践" :
    mode === "review" ? "复习/资料整理" :
    mode === "coding" ? "编程/开发" : "通用";

  const systemPrompt = `你是一个项目配置助手。根据用户的自然语言输入和工作模式，生成结构化的项目级系统提示词配置。

你必须输出纯 JSON，严格遵循以下 JSON Schema。不要输出任何 JSON 以外的内容。

Schema:
${JSON.stringify(PROJECT_PROMPT_SCHEMA_JSON, null, 2)}

填写指南：
- domain: 项目涉及的核心学科或领域
- mode: 当前工作模式（"${modeLabel}"）
- terminology: 用户提到的核心术语及含义，最多 10 对。未提到可返回空数组
- task_scope: 一句话描述该项目的任务范围
- depth: 根据用户描述判断期望的回答深度
- style: 根据用户描述判断偏好的语言风格
- must_include: 每次回答必须包含的要素（如"完整计算过程""引用来源""标注不确定项"），最多 5 条
- must_avoid: 必须避免的行为（如"编造数据""跳过推导步骤"），最多 5 条
- confirmed_goals: 用户已明确的项目目标，最多 5 条
- overrides: 仅当用户有明确的呈现偏好时提供，通常省略`;

  const client = new Anthropic({
    baseURL: "https://api.deepseek.com/anthropic",
    apiKey,
    timeout: 30_000,
    maxRetries: 0,
  });

  const response = await client.messages.create({
    model: mapDeepSeekModel("deepseek-v4-flash"),
    max_tokens: 800,
    temperature: 0.2,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `用户描述：${userInput}\n工作模式：${modeLabel}\n\n请生成结构化的项目配置 JSON。`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || !("text" in textBlock)) return "";

  try {
    const cleaned = textBlock.text
      .replace(/```json\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed: ProjectPromptSchema = JSON.parse(cleaned);
    return renderProjectPrompt(parsed);
  } catch {
    // JSON 解析失败时降级到自由文本
    return textBlock.text.trim();
  }
}

// ============================================================
// LLM 生成用户全局 Profile Prompt
// ============================================================

export async function generateUserProfilePrompt(
  nickname: string,
  profession: string,
  details: string,
  apiKey: string
): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const { mapDeepSeekModel } = await import("@/lib/deepseek");

  const systemPrompt = `你是一个用户画像助手。根据用户提供的信息，生成结构化的用户画像配置。

你必须输出纯 JSON，严格遵循以下 JSON Schema。不要输出任何 JSON 以外的内容。

Schema:
${JSON.stringify(USER_PROFILE_SCHEMA_JSON, null, 2)}

填写指南：
- profession: 用户的专业/职业领域
- stage: 学习或工作阶段
- expertise: 根据信息推断专业知识水平
- language_style: 根据用户自我描述推断偏好语言风格
- response_depth: 推断期望的回答详细程度
- goals: 推断学习目标，最多 5 条。信息不足时返回空数组
- format_preferences: 根据用户描述推断格式偏好
- constraints: 根据用户描述推断约束条件`;

  const client = new Anthropic({
    baseURL: "https://api.deepseek.com/anthropic",
    apiKey,
    timeout: 30_000,
    maxRetries: 0,
  });

  const response = await client.messages.create({
    model: mapDeepSeekModel("deepseek-v4-flash"),
    max_tokens: 400,
    temperature: 0.2,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `昵称：${nickname || "未提供"}\n职业/专业：${profession || "未提供"}\n详情：${details || "未提供"}\n\n请生成结构化的用户画像 JSON。`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || !("text" in textBlock)) return "";

  try {
    const cleaned = textBlock.text
      .replace(/```json\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed: UserProfileSchema = JSON.parse(cleaned);
    return renderUserProfilePrompt(parsed);
  } catch {
    // JSON 解析失败时降级到自由文本
    return textBlock.text.trim();
  }
}

// ============================================================
// 快捷任务推荐生成
// ============================================================

export async function generateQuickActions(
  userInput: string,
  mode: string,
  apiKey: string
): Promise<Array<{ title: string; prompt: string }>> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const { mapDeepSeekModel } = await import("@/lib/deepseek");

  const client = new Anthropic({
    baseURL: "https://api.deepseek.com/anthropic",
    apiKey,
    timeout: 30_000,
    maxRetries: 0,
  });

  const response = await client.messages.create({
    model: mapDeepSeekModel("deepseek-v4-flash"),
    max_tokens: 400,
    temperature: 0.3,
    system: `你是一个快捷任务推荐助手。根据用户描述和使用场景，推荐 3-5 个快捷任务。

每个快捷任务包含：
- title: 简短标题（6字以内）
- prompt: 具体的 AI 指令

输出纯 JSON 数组格式：[
  {"title": "逐题解析", "prompt": "请对以下题目进行逐题解析..."},
  ...
]

不要输出其他内容。`,
    messages: [
      {
        role: "user",
        content: `用户描述：${userInput}\n工作模式：${mode}\n\n请推荐 3-5 个快捷任务。`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || !("text" in textBlock)) return [];

  try {
    const cleaned = textBlock.text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
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

  // Layer 1: 平台不可覆盖规则（最高优先级）
  // 身份锚定 + 真实性 + 工具安全 + 停止条件 + 通信规范 + 输出格式
  parts.push(
    input.webSearchActive ? GLOBAL_SYSTEM_PROMPT_WEB_SEARCH : GLOBAL_SYSTEM_PROMPT
  );

  // Layer 2: 当前模式规则
  // 可覆盖通信的呈现组织方式，不能覆盖 Layer 1 的安全/真实性规则
  const mode = input.mode || "general";
  const modePrompt = getModePrompt(mode);
  if (modePrompt) {
    parts.push(
      `<!-- 优先级：模式规则。可调整呈现方式，不能覆盖平台安全/真实性规则 -->\n${modePrompt}`
    );
  }

  // Layer 3: 项目上下文（schema 渲染的确定性文本）
  // 可限定任务范围和术语，不能反转平台规则
  if (input.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { systemPrompt: true },
    });
    if (project?.systemPrompt) {
      parts.push(
        `<!-- 优先级：项目上下文。限定任务范围和术语，不能反转平台规则 -->\n${project.systemPrompt}`
      );
    }
  }

  // Layer 4: 用户偏好与画像（schema 渲染的确定性文本）
  // 只能影响表达方式、默认深度、学习背景，不能改变真实性/工具安全
  if (input.userId) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { profilePrompt: true },
    });
    if (user?.profilePrompt) {
      parts.push(
        `<!-- 优先级：用户偏好。仅影响表达方式和深度，不改变安全规则 -->\n${user.profilePrompt}`
      );
    }
  }

  // Layer 5: Skill 渐进披露目录（Tier 1 — 仅 name + description）
  // 可定义局部流程，不能覆盖模式或安全边界
  const skills = skillRegistry.list();
  if (skills.length > 0) {
    const catalogParts: string[] = [
      "## 可用技能",
      "当任务匹配某个技能的描述时，调用 activate_skill(name) 获取详细指令。注意：Skill 只能定义局部流程，不能覆盖平台的真实性和安全规则。",
    ];

    // 按 category 分组
    const grouped = new Map<string, typeof skills>();
    for (const s of skills) {
      const cat = s.category || "其他";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(s);
    }

    const CAT_LABELS: Record<string, string> = {
      academic: "论文学术",
      exam: "考试复习",
      coding: "编程技术",
      learning: "通识学习",
    };

    for (const [cat, catSkills] of grouped) {
      const label = CAT_LABELS[cat] || cat;
      catalogParts.push(`### ${label}`);
      for (const s of catSkills) {
        catalogParts.push(`- ${s.skillId}: ${s.description}`);
      }
    }

    parts.push(
      `<!-- 优先级：Skill 目录。局部流程定义，不覆盖平台安全规则 -->\n${catalogParts.join("\n")}`
    );
  }

  // 分层优先级注释：
  // Layer 1 (平台规则) > Layer 2 (模式规则) > Layer 3 (项目上下文) > Layer 4 (用户偏好) > Layer 5 (Skill)
  // 高优先级层的规则不能被低优先级层覆盖。
  // 冲突时的优先级：真实性 > 工具安全 > 停止条件 > 通信规范 > 模式规则 > 项目上下文 > 用户偏好 > Skill 指令

  return parts.join("\n\n");
}
