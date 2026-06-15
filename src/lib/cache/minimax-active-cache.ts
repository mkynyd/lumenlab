import type { cacheExperiments } from "@/lib/cache/experiment-config";

export function applyActiveCache<T extends object>(
  requestBody: T,
  config: typeof cacheExperiments.minimaxActiveCache
): T {
  if (!config.enabled) return requestBody;
  const system = (requestBody as { system?: unknown }).system;
  if (typeof system !== "string") return requestBody;
  const estimatedTokens = Math.ceil(system.length / 4);
  if (estimatedTokens < config.minTokens) return requestBody;

  return {
    ...requestBody,
    system: [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      },
    ],
  } as T;
}
