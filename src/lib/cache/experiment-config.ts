type Environment = Record<string, string | undefined>;

export function buildCacheExperiments(environment: Environment) {
  return {
    adaptivePromptOrdering: {
      enabled: environment.CACHE_EXPERIMENT_PROMPT_REORDER === "true",
      hitRateThreshold: 0.8,
      strategy: (environment.CACHE_EXPERIMENT_REORDER_STRATEGY ||
        "rag-to-last-user") as
        | "rag-to-last-user"
        | "frequent-context-to-system",
    },
  } as const;
}

export const cacheExperiments = buildCacheExperiments(process.env);

export function getActiveExperiments(
  config: ReturnType<typeof buildCacheExperiments> = cacheExperiments
): string[] {
  return Object.entries(config)
    .filter(([, experiment]) => experiment.enabled)
    .map(([key]) => key);
}
