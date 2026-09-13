import type { ProviderName } from "@/lib/agent/contracts";
import {
  activeModelForStoredModel,
  DEEPSEEK_CHAT_MODEL,
  isActiveChatModel,
  isKnownChatModel,
  providerForChatModel,
  type CatalogModelId,
  type ChatModel,
} from "@/lib/chat/model-catalog";
import type { ResearchRole } from "./contracts";

export interface ResearchModelSelection {
  role: ResearchRole;
  provider: ProviderName;
  model: ChatModel;
  reasoningEffort: "high" | "max";
  source: "default" | "environment" | "run_override";
}

const DEFAULTS: Record<ResearchRole, Omit<ResearchModelSelection, "role" | "source">> = {
  "research.planner": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
  "research.worker": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
  "research.source_triage": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
  "research.evaluator": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
  "research.claim_extractor": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
  // 视觉证据只做「受约束的图表读数」，不做自由推理：复用同一活跃 DeepSeek 多模态
  // 模型，thinking 关闭（runResearchModelStage 统一设置），每次 Run 的调用次数由
  // visual budget 硬上限控制。
  "research.visual_evaluator": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
  "research.report_architect": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
  "research.synthesizer": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "max" },
  "research.verifier": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
  "research.report_auditor": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
};

const ROLES: ResearchRole[] = ["research.planner", "research.worker", "research.source_triage", "research.evaluator", "research.claim_extractor", "research.visual_evaluator", "research.report_architect", "research.synthesizer", "research.verifier", "research.report_auditor"];

export function isResearchRole(value: string): value is ResearchRole {
  return ROLES.includes(value as ResearchRole);
}

export function selectResearchModel(role: ResearchRole, override?: ChatModel | null): ResearchModelSelection {
  if (override) {
    return {
      role,
      provider: providerForChatModel(override)!,
      model: override,
      reasoningEffort: role === "research.synthesizer" ? "max" : "high",
      source: "run_override",
    };
  }
  const fallback = DEFAULTS[role];
  const environmentKey = `RESEARCH_MODEL_${role.replace(/[^A-Z0-9]+/gi, "_").toUpperCase()}`;
  const configured = process.env[environmentKey]?.trim();
  if (!configured) return { role, ...fallback, source: "default" };

  const model = resolveConfiguredModel(configured, environmentKey);
  return {
    role,
    provider: providerForChatModel(model)!,
    model,
    reasoningEffort: role === "research.synthesizer" ? "max" : "high",
    source: "environment",
  };
}

export function researchModelConfiguration(override?: ChatModel | null): Record<ResearchRole, ResearchModelSelection> {
  return Object.fromEntries(ROLES.map((role) => [role, selectResearchModel(role, override)])) as Record<ResearchRole, ResearchModelSelection>;
}

/**
 * Per-run 指挥模型只接受活跃目录模型：非法输入（非字符串、历史别名、未知
 * ID）一律返回 null，由调用方决定拒绝或忽略，不走 resolveConfiguredModel
 * 的 legacy 升级与抛错路径。
 */
export function resolveCommanderModel(value: unknown): ChatModel | null {
  return typeof value === "string" && isActiveChatModel(value) ? value as ChatModel : null;
}

function resolveConfiguredModel(value: string, environmentKey: string): ChatModel {
  if (isActiveChatModel(value)) return value as ChatModel;
  if (isKnownChatModel(value)) {
    return activeModelForStoredModel(value as CatalogModelId);
  }
  throw new Error(
    `${environmentKey} must name an active or known legacy chat model`
  );
}
