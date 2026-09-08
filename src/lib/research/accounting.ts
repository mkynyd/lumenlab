import type { AgentModel, AgentUsage } from "@/lib/agent/contracts";
import { calculateCredits } from "@/lib/tokens/credits";

export interface ResearchUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costCredits: number;
}

export const EMPTY_RESEARCH_USAGE: ResearchUsageTotals = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  costCredits: 0,
};

export function addResearchUsage(
  current: ResearchUsageTotals,
  usage: AgentUsage | null | undefined,
  model: AgentModel
): ResearchUsageTotals {
  if (!usage) return { ...current };
  const promptCacheHitTokens = usage.promptCacheHitTokens ?? 0;
  const promptCacheMissTokens = Math.max(
    usage.promptCacheMissTokens ?? 0,
    usage.promptTokens - promptCacheHitTokens,
    0
  );
  const totalTokens = usage.totalTokens || usage.promptTokens + usage.completionTokens;
  return {
    promptTokens: current.promptTokens + usage.promptTokens,
    completionTokens: current.completionTokens + usage.completionTokens,
    totalTokens: current.totalTokens + totalTokens,
    costCredits: current.costCredits + calculateCredits(model, {
      inputCacheHitTokens: promptCacheHitTokens,
      inputCacheMissTokens: promptCacheMissTokens,
      outputTokens: usage.completionTokens,
    }),
  };
}
