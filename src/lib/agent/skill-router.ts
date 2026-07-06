/**
 * LumenLab Skill Router
 *
 * 基于 skill metadata triggers + 硬编码 fallback 的自动路由。
 * 迁移策略：优先使用 skillRegistry 中每个 skill 的 triggers（来自 policy.json），
 * 当无 triggers 时 fallback 到硬编码关键词以确保向后兼容。
 */

import { skillRegistry } from "./skill-registry";

export type TaskProfile = "simple" | "rag" | "research" | "workflow";
export type SkillRouteStatus = "none" | "active" | "awaiting_context";
export type SkillRouteSource = "manual" | "rule" | "none";

export interface RoutingFileSignal {
  id: string;
  name: string;
  mimeType?: string | null;
}

export interface SkillSuggestion {
  skillId: string;
  label: string;
  reason: string;
}

export interface SkillRouteInput {
  message: string;
  hiddenPrompt?: string;
  manualSkillId?: string | null;
  previousActiveSkillId?: string | null;
  projectId?: string | null;
  selectedFileIds?: string[];
  selectedFiles?: RoutingFileSignal[];
  webSearchActive?: boolean;
  skillOff?: boolean;
  skillDisabled?: boolean;
  isQuickTask?: boolean;
}

export interface SkillRouteResult {
  activeSkillId: string | null;
  status: SkillRouteStatus;
  source: SkillRouteSource;
  confidence: number;
  reason: string;
  missingInfo: string[];
  suggestions: SkillSuggestion[];
  profile: TaskProfile;
  webAccessRecommended: boolean;
}

const CONTEXT_REQUEST =
  "请上传文档、粘贴论文编号（例如 arXiv ID ），或选择项目资料。";

/** 动态获取已注册 skill 的 ID 集合（来自 skillRegistry） */
function getBuiltinSkillIds(): Set<string> {
  const registered = skillRegistry.list().map((s) => s.skillId);
  if (registered.length > 0) return new Set(registered);
  // Fallback: skillRegistry 为空时（测试环境或注册未完成），使用硬编码集合
  return new Set([
    "paper-reader", "paper-writer", "exam-extract",
    "exam-coach", "code-reader", "socratic-tutor",
  ]);
}

function normalize(input: string) {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(text: string, patterns: Array<string | RegExp>) {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? text.includes(pattern) : pattern.test(text)
  );
}

function hasSelectedContext(input: SkillRouteInput) {
  return Boolean(
    input.selectedFileIds?.length ||
    input.selectedFiles?.length
  );
}

function hasProjectContext(input: SkillRouteInput) {
  return hasSelectedContext(input) || Boolean(input.projectId && input.isQuickTask);
}

function needsProjectMaterial(input: SkillRouteInput) {
  const text = normalize([input.hiddenPrompt, input.message].filter(Boolean).join("\n"));
  return includesAny(text, [
    "资料",
    "文件",
    "文档",
    "课件",
    "ppt",
    "章节",
    "根据这些",
    "根据项目",
    "总结一下这份",
    "总结一下这些",
    "选中的",
  ]);
}

function fileSignals(input: SkillRouteInput) {
  return (input.selectedFiles ?? []).map((file) => normalize(file.name)).join("\n");
}

function isLikelyUniversitySlideDeck(input: SkillRouteInput) {
  const names = fileSignals(input);
  if (!names) return false;
  return includesAny(names, [
    ".ppt",
    ".pptx",
    /第\s*\d+\s*[章节讲]/,
    /\d+[_-].+\.pptx?/,
    /chapter\s*\d+/,
  ]);
}

function inferProfile(input: SkillRouteInput, skillId: string | null): TaskProfile {
  if (input.isQuickTask && input.projectId) return "rag";
  if (skillId === "paper-reader") return "research";
  if (skillId === "paper-writer") return "workflow";
  if (skillId === "exam-extract" || skillId === "exam-coach") return "rag";
  if (skillId === "code-reader") return hasSelectedContext(input) ? "rag" : "simple";
  if (input.webSearchActive) return "research";
  if (hasSelectedContext(input)) return "rag";
  if (input.projectId && needsProjectMaterial(input)) return "rag";
  return "simple";
}

function defaultSuggestions(input: SkillRouteInput, activeSkillId: string | null) {
  const suggestions: SkillSuggestion[] = [];
  const add = (skillId: string, label: string, reason: string) => {
    if (skillId !== activeSkillId) suggestions.push({ skillId, label, reason });
  };
  if (hasSelectedContext(input)) {
    add("socratic-tutor", "引导我深入理解", "用追问帮助继续拆解资料");
    add("exam-extract", "考点分析", "从资料里抽取考点和题型");
    add("exam-coach", "生成速记卡", "把内容转成复习卡和自测题");
  } else {
    add("socratic-tutor", "引导我深入理解", "用追问帮助继续拆解概念");
  }
  return suggestions;
}

/**
 * 基于 skill metadata triggers（来自 policy.json）的路由匹配。
 * 遍历所有已注册 skill 的 triggers.include/exclude 规则，
 * 根据命中的 include 数量计算置信度。
 */
function routeByTriggers(input: SkillRouteInput) {
  const text = normalize([input.hiddenPrompt, input.message].filter(Boolean).join("\n"));
  const files = fileSignals(input);
  const skills = skillRegistry.list();

  let bestMatch: { skillId: string; confidence: number; reason: string } | null = null;

  for (const skill of skills) {
    const triggers = skill.triggers;
    if (!triggers || (!triggers.include.length && !triggers.exclude.length)) continue;

    // exclude 检查（任一命中则跳过该 skill）
    const excludeHits = triggers.exclude.filter((p) =>
      includesAny(text, [p]) || (files && includesAny(files, [p]))
    );
    if (excludeHits.length > 0) continue;

    // include 检查
    const includeHits = triggers.include.filter((p) =>
      includesAny(text, [p]) || (files && includesAny(files, [p]))
    );
    if (includeHits.length === 0) continue;

    // 置信度：命中数 / 总 include 数，基础值不低于 0.78
    const ratio = includeHits.length / triggers.include.length;
    const confidence = Math.max(0.78, Math.min(0.95, 0.85 + ratio * 0.1));

    if (!bestMatch || confidence > bestMatch.confidence) {
      bestMatch = {
        skillId: skill.skillId,
        confidence: Math.round(confidence * 100) / 100,
        reason: `Matched triggers: ${includeHits.slice(0, 3).join(", ")}`,
      };
    }
  }

  return bestMatch;
}

/**
 * 硬编码关键词 fallback 路由。
 * 当 triggers-based 路由无匹配时使用，保证向后兼容。
 */
function routeByHardcodedRules(input: SkillRouteInput) {
  const text = normalize([input.hiddenPrompt, input.message].filter(Boolean).join("\n"));
  const files = fileSignals(input);

  if (
    includesAny(text, [
      "苏格拉底",
      "socratic",
      "引导我",
      "追问",
      "一步步问",
      "启发式",
    ])
  ) {
    return {
      skillId: "socratic-tutor",
      confidence: 0.92,
      reason: "Socratic tutoring intent (hardcoded fallback)",
    };
  }

  if (
    includesAny(text, [
      "速记卡",
      "记忆卡",
      "flashcard",
      "自测题",
      "刷题",
      "复习计划",
      "exam coach",
    ])
  ) {
    return { skillId: "exam-coach", confidence: 0.88, reason: "Exam coaching intent (hardcoded fallback)" };
  }

  if (
    includesAny(text, ["考试重点", "考点", "大题", "选择题", "填空题", "题型", "期末"]) &&
    (hasSelectedContext(input) || isLikelyUniversitySlideDeck(input))
  ) {
    return {
      skillId: "exam-extract",
      confidence: files ? 0.9 : 0.82,
      reason: "Exam extraction intent (hardcoded fallback)",
    };
  }

  if (
    includesAny(text, [
      "论文初稿",
      "paper draft",
      "ieee",
      "acm",
      "latex",
      "摘要",
      "introduction",
      "related work",
    ]) &&
    includesAny(text, ["写", "撰写", "生成", "draft", "paper", "论文"])
  ) {
    return { skillId: "paper-writer", confidence: 0.86, reason: "Paper writing intent (hardcoded fallback)" };
  }

  if (
    includesAny(text, [
      "精读",
      "读论文",
      "paper reader",
      "arxiv:",
      "doi:",
      "openreview",
      "论文",
    ]) &&
    !includesAny(text, ["写一篇", "撰写", "初稿"])
  ) {
    return { skillId: "paper-reader", confidence: 0.84, reason: "Paper reading intent (hardcoded fallback)" };
  }

  if (
    includesAny(text, [
      "调用链",
      "代码",
      "typescript",
      "react",
      "next.js",
      "函数",
      "class",
      "repository",
      "项目结构",
    ])
  ) {
    return { skillId: "code-reader", confidence: 0.78, reason: "Code reading intent (hardcoded fallback)" };
  }

  return null;
}

function routeByRules(input: SkillRouteInput) {
  // 优先尝试 triggers-based 路由
  const triggerMatch = routeByTriggers(input);
  if (triggerMatch) return triggerMatch;

  // Fallback 到硬编码关键词
  const hardcoded = routeByHardcodedRules(input);
  if (hardcoded) return hardcoded;

  return { skillId: null, confidence: 0, reason: "No skill intent" };
}

function missingInfoFor(skillId: string, input: SkillRouteInput) {
  if (skillId === "paper-reader" && !hasSelectedContext(input)) {
    return [CONTEXT_REQUEST];
  }
  if (
    (skillId === "exam-extract" || skillId === "exam-coach" || skillId === "code-reader") &&
    !hasProjectContext(input)
  ) {
    return [CONTEXT_REQUEST];
  }
  return [];
}

export function routeSkill(input: SkillRouteInput): SkillRouteResult {
  const builtinIds = getBuiltinSkillIds();

  if (input.manualSkillId && builtinIds.has(input.manualSkillId)) {
    const missingInfo = missingInfoFor(input.manualSkillId, input);
    return {
      activeSkillId: input.manualSkillId,
      status: missingInfo.length ? "awaiting_context" : "active",
      source: "manual",
      confidence: 1,
      reason: "Manual skill selection",
      missingInfo,
      suggestions: defaultSuggestions(input, input.manualSkillId),
      profile: inferProfile(input, input.manualSkillId),
      webAccessRecommended: input.manualSkillId === "paper-reader",
    };
  }

  if (input.skillOff || input.skillDisabled) {
    return {
      activeSkillId: null,
      status: "none",
      source: "manual",
      confidence: 1,
      reason: input.skillOff ? "User turned skill off for this message" : "Skill disabled for this conversation",
      missingInfo: [],
      suggestions: defaultSuggestions(input, null),
      profile: inferProfile(input, null),
      webAccessRecommended: input.webSearchActive === true,
    };
  }

  const routed = routeByRules(input);
  const skillId = routed.skillId;
  const missingInfo = skillId ? missingInfoFor(skillId, input) : [];
  const status: SkillRouteStatus = skillId
    ? missingInfo.length ? "awaiting_context" : "active"
    : "none";

  return {
    activeSkillId: skillId,
    status,
    source: skillId ? "rule" : "none",
    confidence: routed.confidence,
    reason: routed.reason,
    missingInfo,
    suggestions: defaultSuggestions(input, skillId),
    profile: inferProfile(input, skillId),
    webAccessRecommended:
      input.webSearchActive === true ||
      skillId === "paper-reader" ||
      includesAny(normalize(input.message), [/https?:\/\//, "最新", "联网", "搜索"]),
  };
}
