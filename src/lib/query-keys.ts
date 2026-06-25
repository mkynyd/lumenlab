export const queryKeys = {
  conversations: {
    all: ["conversations"] as const,
    detail: (id: string) => ["conversations", id] as const,
  },
  projects: {
    all: ["projects"] as const,
    detail: (id: string) => ["projects", id] as const,
    files: (projectId: string) =>
      ["projects", projectId, "files"] as const,
    artifacts: (projectId: string) =>
      ["projects", projectId, "artifacts"] as const,
    vectorLibrary: (projectId: string) =>
      ["projects", projectId, "vector-library"] as const,
  },
  files: {
    detail: (id: string) => ["files", id] as const,
  },
  artifacts: {
    detail: (id: string) => ["artifacts", id] as const,
  },
  conversions: {
    all: ["conversions"] as const,
    detail: (id: string) => ["conversions", id] as const,
  },
  keys: ["api-keys"] as const,
  cacheMetrics: (days: number) => ["cache-metrics", days] as const,
} as const;
