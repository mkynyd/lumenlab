import type { AgentUsage } from "@/lib/agent/contracts";

function normalizedUsage(usage: AgentUsage): Required<AgentUsage> {
  const promptCacheHitTokens = usage.promptCacheHitTokens ?? 0;
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    promptCacheHitTokens,
    promptCacheMissTokens: Math.max(
      usage.promptCacheMissTokens ?? 0,
      usage.promptTokens - promptCacheHitTokens,
      0
    ),
  };
}

export function mergeAgentUsage(
  ...values: Array<AgentUsage | null | undefined>
): AgentUsage | null {
  const usages = values.filter(
    (value): value is AgentUsage => value !== null && value !== undefined
  );
  if (usages.length === 0) return null;

  return usages.map(normalizedUsage).reduce<Required<AgentUsage>>(
    (total, usage) => ({
      promptTokens: total.promptTokens + usage.promptTokens,
      completionTokens: total.completionTokens + usage.completionTokens,
      totalTokens: total.totalTokens + usage.totalTokens,
      promptCacheHitTokens:
        total.promptCacheHitTokens + usage.promptCacheHitTokens,
      promptCacheMissTokens:
        total.promptCacheMissTokens + usage.promptCacheMissTokens,
    }),
    {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 0,
    }
  );
}
