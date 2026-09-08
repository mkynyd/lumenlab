/**
 * 聊天模型目录（任务 01.1 结构化模型目录）。
 *
 * 目录是模型 ID 的唯一事实来源：
 * - 活跃模型（enabled: true）才能用于新请求，见 ALL_CHAT_MODELS；
 * - 历史别名（enabled: false）仅保留映射与展示标签，用于渲染历史消息、
 *   读取历史 TokenUsage/账单；新请求不得再使用历史 wire 模型。
 * 历史消息标签、TokenUsage 与已结算账单一律以记录中的模型 ID 原样展示，
 * 不做改写。
 */

export type ModelInputType = "text" | "image" | "video" | "audio";

export type ChatModelProvider = "deepseek" | "minimax" | "bailian";

export type ReasoningEffortLevel = "high" | "max";

export type ModelCatalogEntry = {
  /** 平台内部模型 ID（消息、TokenUsage、账单中的标识） */
  id: string;
  /** 供应商 wire ID（发往上游的 model 字段） */
  wireId: string;
  provider: ChatModelProvider;
  /** UI 展示标签（保持简短，避免选择器换行） */
  displayName: string;
  /** 供应商展示名 */
  vendor: string;
  /** 模型选择器详情栏完整名；缺省时用 displayName */
  detailName?: string;
  /** 官方口径的 1–2 句简介（来源见各条目注释） */
  description: string;
  /** 详情栏输入类型展示文案 */
  inputLabel?: string;
  /** 支持的输入类型 */
  inputTypes: readonly ModelInputType[];
  /** 上下文窗口（tokens） */
  contextWindowTokens: number;
  /** 单次最大输出（tokens） */
  maxOutputTokens: number;
  /** 内部 reasoningEffort → 供应商 effort 值；null 表示不支持思考调节 */
  reasoningEffort: Record<ReasoningEffortLevel, string> | null;
  /** true = 活跃（新请求可用）；false = 历史别名（仅展示与历史结算） */
  enabled: boolean;
  /** 计费规则版本：供应商价格或平台权重调整时递增 */
  billingVersion: string;
};

/** 当前计费规则版本（2026-09-07 模型与价格表） */
export const MODEL_BILLING_VERSION = "2026-09-07" as const;

export const DEFAULT_CHAT_MODELS = [
  "deepseek-v4-flash-vision-exp",
  "minimax-m3",
] as const;

export const QWEN_CHAT_MODEL = "qwen3.8-flash" as const;

export const DEFAULT_CHAT_MODEL = QWEN_CHAT_MODEL;

export const ALL_CHAT_MODELS = [
  QWEN_CHAT_MODEL,
  ...DEFAULT_CHAT_MODELS,
] as const;

export type ChatModel = (typeof ALL_CHAT_MODELS)[number];

/**
 * 历史别名：保留 ID → 供应商/标签的映射，保证历史消息与账单可展示、
 * 存量 v1 checkpoint 可解析；新请求由 sendMessageSchema 拒绝。
 */
export const LEGACY_CHAT_MODELS = [
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "qwen3.7-plus",
] as const;

export type LegacyChatModel = (typeof LEGACY_CHAT_MODELS)[number];

export type CatalogModelId = ChatModel | LegacyChatModel;

export const MODEL_CATALOG_ENTRIES: readonly ModelCatalogEntry[] = [
  {
    id: "qwen3.8-flash",
    wireId: "qwen3.8-flash",
    provider: "bailian",
    displayName: "Qwen3.8-Flash",
    vendor: "阿里云百炼",
    // 简介与能力口径：模型更新列表 qwen3.8-flash 官方参数表；
    // 音频输入 Responses/平台均未开放，不在此宣称。
    description: "通义千问 Qwen3.8 系列的 Flash 档模型，支持 Function Calling、结构化输出、联网搜索与缓存加速，输入覆盖文本、图片与视频。",
    inputLabel: "文本 · 图片 · 视频",
    inputTypes: ["text", "image"],
    contextWindowTokens: 1_000_000,
    // 百炼模型列表未给出输出上限，沿用平台既有预算口径
    maxOutputTokens: 64_000,
    // Qwen reasoning.effort 默认 medium；内部 high/max 映射为 medium/high
    reasoningEffort: { high: "medium", max: "high" },
    enabled: true,
    billingVersion: MODEL_BILLING_VERSION,
  },
  {
    id: "deepseek-v4-flash-vision-exp",
    wireId: "deepseek-v4-flash-vision-exp",
    provider: "deepseek",
    displayName: "DeepSeek V4 Flash",
    vendor: "DeepSeek",
    detailName: "DeepSeek V4 Flash Vision",
    // 简介与图片能力口径：api-docs.deepseek.com「图像理解」与模型更新列表
    description: "DeepSeek V4 系列的快速视觉模型：除文本外支持输入图片，可描述图片、识别截图文字、分析图表；思考模式默认开启。",
    inputLabel: "文本 · 图片",
    inputTypes: ["text", "image"],
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    reasoningEffort: { high: "high", max: "max" },
    enabled: true,
    billingVersion: MODEL_BILLING_VERSION,
  },
  {
    id: "minimax-m3",
    wireId: "MiniMax-M3",
    provider: "minimax",
    displayName: "MiniMax M3",
    vendor: "MiniMax",
    // 简介口径：platform.minimaxi.com「模型概览」（M3 原文）
    description: "MiniMax 的 Frontier Coding 模型：原生多模态，支持 1M 上下文。",
    inputLabel: "文本 · 图片",
    inputTypes: ["text", "image"],
    contextWindowTokens: 1_000_000,
    // MiniMax 文档未给出 M3 输出上限，沿用平台既有预算口径
    maxOutputTokens: 128_000,
    // MiniMax 接受 effort 但不调节深度；内部 high/max 映射为 medium/high
    reasoningEffort: { high: "medium", max: "high" },
    enabled: true,
    billingVersion: MODEL_BILLING_VERSION,
  },
  // —— 历史别名（enabled: false，仅历史展示与结算） ——
  {
    id: "deepseek-v4-flash",
    wireId: "deepseek-v4-flash",
    provider: "deepseek",
    displayName: "DeepSeek V4 Flash",
    vendor: "DeepSeek",
    description: "历史 DeepSeek V4 Flash 模型，已被 vision-exp 视觉模型取代，仅用于历史消息与账单展示。",
    inputTypes: ["text"],
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    reasoningEffort: { high: "high", max: "max" },
    enabled: false,
    billingVersion: "legacy",
  },
  {
    id: "deepseek-v4-pro",
    wireId: "deepseek-v4-pro",
    provider: "deepseek",
    displayName: "DeepSeek V4 Pro",
    vendor: "DeepSeek",
    description: "历史 DeepSeek V4 Pro 模型，不支持多模态，已停止用于新请求，仅用于历史消息与账单展示。",
    inputTypes: ["text"],
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    reasoningEffort: { high: "high", max: "max" },
    enabled: false,
    billingVersion: "legacy",
  },
  {
    id: "qwen3.7-plus",
    wireId: "qwen3.7-plus",
    provider: "bailian",
    displayName: "Qwen3.7-Plus",
    vendor: "阿里云百炼",
    description: "历史通义千问 Qwen3.7-Plus 模型，新请求已迁移至 Qwen3.8-Flash，仅用于历史消息与账单展示。",
    inputTypes: ["text", "image", "video"],
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 32_000,
    reasoningEffort: { high: "medium", max: "high" },
    enabled: false,
    billingVersion: "legacy",
  },
];

export const MODEL_CATALOG: Readonly<Record<CatalogModelId, ModelCatalogEntry>> =
  Object.fromEntries(
    MODEL_CATALOG_ENTRIES.map((entry) => [entry.id, entry])
  ) as Record<CatalogModelId, ModelCatalogEntry>;

export function getModelCatalogEntry(model: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG[model as CatalogModelId];
}

/** 目录中已知（活跃或历史别名） */
export function isKnownChatModel(model: string): boolean {
  return getModelCatalogEntry(model) !== undefined;
}

/** 活跃且可用于新请求（不含 Qwen 灰度开关，开关见 isChatModelEnabled） */
export function isActiveChatModel(model: string): boolean {
  return getModelCatalogEntry(model)?.enabled === true;
}

export function providerForChatModel(
  model: string
): ChatModelProvider | undefined {
  return getModelCatalogEntry(model)?.provider;
}

/** Resolve a stored legacy model to the active model that will actually be called. */
export function activeModelForStoredModel(model: CatalogModelId): ChatModel {
  if (model === "deepseek-v4-flash" || model === "deepseek-v4-pro") {
    return "deepseek-v4-flash-vision-exp";
  }
  if (model === "qwen3.7-plus") return "qwen3.8-flash";
  return model;
}

/** 历史消息/账单的展示标签；未知 ID 原样返回 */
export function chatModelLabel(model: string): string {
  return getModelCatalogEntry(model)?.displayName ?? model;
}

export function isQwenModelEnabled(value = process.env.MODEL_QWEN_ENABLED) {
  return value === "true";
}

export function availableChatModels(
  qwenEnabled = process.env.MODEL_QWEN_ENABLED
): readonly ChatModel[] {
  return isQwenModelEnabled(qwenEnabled)
    ? ALL_CHAT_MODELS
    : DEFAULT_CHAT_MODELS;
}

export function isChatModelEnabled(
  model: string,
  qwenEnabled = process.env.MODEL_QWEN_ENABLED
): model is ChatModel {
  return availableChatModels(qwenEnabled).includes(model as ChatModel);
}

/** Upgrade a saved preference without silently replacing unknown or unavailable choices. */
export function chatModelForPreference(model?: string | null): string {
  if (!model) return DEFAULT_CHAT_MODEL;
  return isKnownChatModel(model)
    ? activeModelForStoredModel(model as CatalogModelId)
    : model;
}
