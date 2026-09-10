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
  source: "default" | "environment";
}

const DEFAULTS: Record<ResearchRole, Omit<ResearchModelSelection, "role" | "source">> = {
  "research.planner": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
  "research.worker": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
  "research.evaluator": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
  "research.claim_extractor": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
  "research.synthesizer": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "max" },
  "research.verifier": { provider: "deepseek", model: DEEPSEEK_CHAT_MODEL, reasoningEffort: "high" },
};

const ROLES: ResearchRole[] = ["research.planner", "research.worker", "research.evaluator", "research.claim_extractor", "research.synthesizer", "research.verifier"];

export function isResearchRole(value: string): value is ResearchRole {
  return ROLES.includes(value as ResearchRole);
}

export function selectResearchModel(role: ResearchRole): ResearchModelSelection {
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

export function researchModelConfiguration(): Record<ResearchRole, ResearchModelSelection> {
  return Object.fromEntries(ROLES.map((role) => [role, selectResearchModel(role)])) as Record<ResearchRole, ResearchModelSelection>;
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
