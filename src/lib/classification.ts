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

  const systemPrompt = `你是一个项目配置助手。根据用户的自然语言输入和工作模式，生成一段结构清晰、内容详尽的项目级系统提示词。

这段提示词会被注入到 AI 助手的系统消息中，是 AI 理解用户的最重要依据。请务必详尽，不要省略。

请按以下结构输出（用中文，使用 Markdown 格式）：

## 用户身份与背景
- 专业/职业领域
- 学习或工作阶段
- 使用场景与目标

## AI 回答规范
- 回答深度：初学者/进阶/专业级
- 语言风格：严谨学术 / 通俗易懂 / 教学引导
- 必须包含的内容要素（如完整推导步骤、引用来源、标注不确定项）
- 禁止的行为（如编造数据、使用 emoji、跳过计算过程）

## 学科与领域偏好
- 涉及的核心学科
- 常用术语和知识框架
- 输出格式偏好（表格/列表/流程图/代码块等）

## 输出质量要求
- 每条回答应达到的标准
- 信息完整度要求
- 对不确定信息的处理方式（标注"[需补充]"或"[待验证]"）

请确保总长度在 400-600 字之间，信息密度高，不含空泛表述。`;

  const client = new Anthropic({
    baseURL: "https://api.deepseek.com/anthropic",
    apiKey,
    timeout: 30_000,
    maxRetries: 0,
  });

  const response = await client.messages.create({
    model: mapDeepSeekModel("deepseek-v4-flash"),
    max_tokens: 800,
    temperature: 0.3,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `用户描述：${userInput}\n工作模式：${modeLabel}\n\n请生成结构化的项目系统提示词。`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock && "text" in textBlock ? textBlock.text.trim() : "";
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

  const client = new Anthropic({
    baseURL: "https://api.deepseek.com/anthropic",
    apiKey,
    timeout: 30_000,
    maxRetries: 0,
  });

  const response = await client.messages.create({
    model: mapDeepSeekModel("deepseek-v4-flash"),
    max_tokens: 250,
    temperature: 0.3,
    system: "你是一个用户画像助手。根据用户提供的信息，生成一段简洁的个人描述提示词，用于帮助 AI 理解用户背景。控制在 150 字以内，中文输出，第三人称。",
    messages: [
      {
        role: "user",
        content: `昵称：${nickname || "未提供"}\n职业/专业：${profession || "未提供"}\n详情：${details || "未提供"}\n\n请生成用户个人描述。`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock && "text" in textBlock ? textBlock.text.trim() : "";
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

  // Layer 1: Global
  parts.push(
    input.webSearchActive ? GLOBAL_SYSTEM_PROMPT_WEB_SEARCH : GLOBAL_SYSTEM_PROMPT
  );

  // Layer 2: User profile prompt
  if (input.userId) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { profilePrompt: true },
    });
    if (user?.profilePrompt) {
      parts.push(`## 用户背景\n${user.profilePrompt}`);
    }
  }

  // Layer 3: Project system prompt (LLM-generated)
  if (input.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { systemPrompt: true },
    });
    if (project?.systemPrompt) {
      parts.push(`## 项目上下文\n${project.systemPrompt}`);
    }
  }

  // Layer 4: Mode prompt
  const mode = input.mode || "general";
  const modePrompt = getModePrompt(mode);
  if (modePrompt) {
    parts.push(modePrompt);
  }

  return parts.join("\n\n");
}
