/**
 * 结构化用户画像与项目提示词 Schema。
 *
 * 设计目的：
 * - 用 schema 约束 LLM 生成的 prompt 内容，避免自由文本产生风格漂移、隐性冲突
 * - 确定性模板渲染 → 可做冲突检测、长度截断、优先级控制、回归测试
 * - 每个字段都有明确的语义职责和覆盖范围
 */

// ============================================================
// 用户画像结构化 Schema
// ============================================================

export interface UserProfileSchema {
  /** 专业/职业领域（中文，如"临床医学""计算机科学""高中物理教师"） */
  profession: string;
  /** 学习或工作阶段（如"本科二年级""考研备考""在职进修"） */
  stage: string;
  /** 专业知识水平 */
  expertise: "beginner" | "intermediate" | "advanced" | "professional";
  /** 偏好语言风格 */
  language_style: "严谨学术" | "通俗易懂" | "教学引导" | "简洁直接";
  /** 回答详细程度偏好 */
  response_depth: "brief" | "standard" | "detailed";
  /** 学习目标（最多 5 条） */
  goals: string[];
  /** 格式偏好 */
  format_preferences: {
    /** 偏好表格展示 */
    prefer_tables: boolean;
    /** 偏好图表/流程图 */
    prefer_diagrams: boolean;
    /** 偏好代码块 */
    prefer_code_blocks: boolean;
  };
  /** 用户明确声明的约束 */
  constraints: {
    /** 禁止使用 emoji */
    no_emoji: boolean;
    /** 需要附原始推导过程 */
    require_derivation: boolean;
    /** 需要标注不确定内容 */
    require_uncertainty_tags: boolean;
  };
}

export const USER_PROFILE_SCHEMA_JSON = {
  type: "object",
  properties: {
    profession: { type: "string", description: "专业/职业领域" },
    stage: { type: "string", description: "学习或工作阶段" },
    expertise: {
      type: "string",
      enum: ["beginner", "intermediate", "advanced", "professional"],
      description: "专业知识水平",
    },
    language_style: {
      type: "string",
      enum: ["严谨学术", "通俗易懂", "教学引导", "简洁直接"],
      description: "偏好语言风格",
    },
    response_depth: {
      type: "string",
      enum: ["brief", "standard", "detailed"],
      description: "回答详细程度",
    },
    goals: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
      description: "学习目标（最多5条）",
    },
    format_preferences: {
      type: "object",
      properties: {
        prefer_tables: { type: "boolean" },
        prefer_diagrams: { type: "boolean" },
        prefer_code_blocks: { type: "boolean" },
      },
      required: ["prefer_tables", "prefer_diagrams", "prefer_code_blocks"],
    },
    constraints: {
      type: "object",
      properties: {
        no_emoji: { type: "boolean" },
        require_derivation: { type: "boolean" },
        require_uncertainty_tags: { type: "boolean" },
      },
      required: ["no_emoji", "require_derivation", "require_uncertainty_tags"],
    },
  },
  required: [
    "profession",
    "stage",
    "expertise",
    "language_style",
    "response_depth",
    "goals",
    "format_preferences",
    "constraints",
  ],
  additionalProperties: false,
} as const;

// ============================================================
// 项目提示词结构化 Schema
// ============================================================

export interface ProjectPromptSchema {
  /** 项目涉及的核心学科/领域 */
  domain: string;
  /** 项目工作模式 */
  mode: string;
  /** 项目中的核心术语及其含义（最多 10 对） */
  terminology: Array<{ term: string; meaning: string }>;
  /** 项目任务范围描述 */
  task_scope: string;
  /** 期望的回答深度 */
  depth: "beginner" | "intermediate" | "advanced" | "professional";
  /** 回答风格 */
  style: "严谨学术" | "通俗易懂" | "教学引导" | "简洁直接";
  /** 必须包含的内容要素（最多 5 条） */
  must_include: string[];
  /** 必须避免的行为（最多 5 条） */
  must_avoid: string[];
  /** 已确认的项目目标（最多 5 条） */
  confirmed_goals: string[];
  /** 与全局规则的冲突声明 */
  overrides?: {
    /** 覆盖全局的呈现组织方式（不允许覆盖真实性/工具安全/停止条件） */
    presentation?: string;
  };
}

export const PROJECT_PROMPT_SCHEMA_JSON = {
  type: "object",
  properties: {
    domain: { type: "string", description: "项目涉及的核心学科/领域" },
    mode: { type: "string", description: "项目工作模式" },
    terminology: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          meaning: { type: "string" },
        },
        required: ["term", "meaning"],
      },
      maxItems: 10,
      description: "核心术语及含义",
    },
    task_scope: { type: "string", description: "项目任务范围" },
    depth: {
      type: "string",
      enum: ["beginner", "intermediate", "advanced", "professional"],
    },
    style: {
      type: "string",
      enum: ["严谨学术", "通俗易懂", "教学引导", "简洁直接"],
    },
    must_include: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
      description: "必须包含的内容要素",
    },
    must_avoid: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
      description: "必须避免的行为",
    },
    confirmed_goals: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
      description: "已确认的项目目标",
    },
    overrides: {
      type: "object",
      properties: {
        presentation: { type: "string" },
      },
      description: "对全局默认呈现方式的覆盖（仅限呈现，不能覆盖安全规则）",
    },
  },
  required: [
    "domain",
    "mode",
    "terminology",
    "task_scope",
    "depth",
    "style",
    "must_include",
    "must_avoid",
    "confirmed_goals",
  ],
  additionalProperties: false,
} as const;

// ============================================================
// 确定性模板渲染器
// ============================================================

/**
 * 将结构化用户画像渲染为注入 prompt 的文本。
 * 约束：只能影响表达方式、默认深度、学习背景，不能改变真实性/工具安全。
 */
export function renderUserProfilePrompt(profile: UserProfileSchema): string {
  const lines: string[] = [];

  lines.push(`- 领域：${profile.profession}`);
  lines.push(`- 阶段：${profile.stage}`);
  lines.push(`- 水平：${renderExpertise(profile.expertise)}`);
  lines.push(`- 风格偏好：${profile.language_style}`);
  lines.push(`- 回答深度：${renderDepth(profile.response_depth)}`);

  if (profile.goals.length > 0) {
    lines.push(`- 学习目标：${profile.goals.join("；")}`);
  }

  const fmtPrefs = profile.format_preferences;
  const fmtParts: string[] = [];
  if (fmtPrefs.prefer_tables) fmtParts.push("表格");
  if (fmtPrefs.prefer_diagrams) fmtParts.push("图表/流程图");
  if (fmtPrefs.prefer_code_blocks) fmtParts.push("代码块");
  if (fmtParts.length > 0) {
    lines.push(`- 格式偏好：优先使用${fmtParts.join("、")}`);
  }

  const constraints = profile.constraints;
  if (constraints.no_emoji) lines.push("- 禁止使用 emoji");
  if (constraints.require_derivation) lines.push("- 需要展示完整推导过程");
  if (constraints.require_uncertainty_tags) lines.push("- 不确定内容必须标注 [需补充] 或 [待验证]");

  return `## 用户画像\n\n${lines.join("\n")}\n\n注意：以上偏好仅影响表达方式和默认深度，不影响真实性和工具安全规则。`;
}

/**
 * 将结构化项目提示词渲染为注入 prompt 的文本。
 * 约束：可以限定任务范围和术语，但不能反转平台规则。
 */
export function renderProjectPrompt(project: ProjectPromptSchema): string {
  const lines: string[] = [];

  lines.push(`**领域**：${project.domain}`);
  lines.push(`**模式**：${renderMode(project.mode)}`);

  if (project.terminology.length > 0) {
    lines.push(`**术语**：${project.terminology.map((t) => `${t.term}（${t.meaning}）`).join("；")}`);
  }

  lines.push(`**任务范围**：${project.task_scope}`);
  lines.push(`**深度**：${renderExpertise(project.depth)}`);
  lines.push(`**风格**：${project.style}`);

  if (project.must_include.length > 0) {
    lines.push(`**必须包含**：${project.must_include.join("；")}`);
  }
  if (project.must_avoid.length > 0) {
    lines.push(`**必须避免**：${project.must_avoid.join("；")}`);
  }
  if (project.confirmed_goals.length > 0) {
    lines.push(`**已确认目标**：${project.confirmed_goals.join("；")}`);
  }

  const content = `## 项目上下文\n\n${lines.join("\n")}`;

  if (project.overrides?.presentation) {
    return `${content}\n\n呈现偏好：${project.overrides.presentation}\n\n注意：以上偏好仅适用于本项目的任务范围和呈现方式，不能覆盖平台的真实性和安全规则。`;
  }

  return content;
}

// ============================================================
// 辅助函数
// ============================================================

function renderExpertise(level: string): string {
  const map: Record<string, string> = {
    beginner: "入门（需要较多解释和示例）",
    intermediate: "进阶（可省略基础概念，直接讨论核心内容）",
    advanced: "高级（可假设已有系统知识，提供专业级分析）",
    professional: "专业（使用领域术语，提供深度分析和前沿视角）",
  };
  return map[level] || level;
}

function renderDepth(level: string): string {
  const map: Record<string, string> = {
    brief: "简洁（直接给结论和关键依据）",
    standard: "标准（结论 + 推导 + 示例）",
    detailed: "详尽（完整推导、多角度分析、延伸阅读）",
  };
  return map[level] || level;
}

function renderMode(mode: string): string {
  const map: Record<string, string> = {
    experiment: "实验/实践",
    review: "复习/资料整理",
    coding: "编程/开发",
    general: "通用",
  };
  return map[mode] || mode;
}
