const learningAll = ["learning"] as const;

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
  research: {
    all: ["research"] as const,
    workspaces: ["research", "workspaces"] as const,
    workspace: (id: string) => ["research", "workspaces", id] as const,
    run: (id: string) => ["research", "runs", id] as const,
    transfer: (id: string) => ["research", "runs", id, "transfer"] as const,
  },
  papers: {
    all: ["papers"] as const,
    workspaces: ["papers", "workspaces"] as const,
    workspace: (id: string) => ["papers", "workspaces", id] as const,
    references: (id: string) => ["papers", "workspaces", id, "references"] as const,
    templates: (query = "") => ["papers", "templates", query] as const,
  },
  learning: {
    all: learningAll,
    goals: (projectId: string) =>
      [...learningAll, "projects", projectId, "goals"] as const,
    scope: (projectId: string, goalId: string) =>
      [...learningAll, "projects", projectId, "goals", goalId, "scope"] as const,
    map: (projectId: string, goalId: string) =>
      [...learningAll, "projects", projectId, "goals", goalId, "map"] as const,
    session: (projectId: string, sessionId: string) =>
      [...learningAll, "projects", projectId, "sessions", sessionId] as const,
    progress: (projectId: string, goalId: string) =>
      [
        ...learningAll,
        "projects",
        projectId,
        "goals",
        goalId,
        "progress",
      ] as const,
    history: (projectId: string, goalId: string) =>
      [
        ...learningAll,
        "projects",
        projectId,
        "goals",
        goalId,
        "history",
      ] as const,
    wrongAnswers: (projectId: string, goalId: string) =>
      [
        ...learningAll,
        "projects",
        projectId,
        "goals",
        goalId,
        "wrong-answers",
      ] as const,
    reviews: (projectId: string, goalId: string) =>
      [
        ...learningAll,
        "projects",
        projectId,
        "goals",
        goalId,
        "reviews",
      ] as const,
    today: () => [...learningAll, "today"] as const,
    studyPacks: (projectId: string, goalId: string) =>
      [
        ...learningAll,
        "projects",
        projectId,
        "goals",
        goalId,
        "study-packs",
      ] as const,
    studyPack: (projectId: string, packId: string) =>
      [
        ...learningAll,
        "projects",
        projectId,
        "study-packs",
        packId,
      ] as const,
  },
  userProfile: ["user-profile"] as const,
  keys: ["api-keys"] as const,
  cacheMetrics: (range: { start: string; end: string } | number | "cycle") =>
    typeof range === "number"
      ? (["cache-metrics", "days", String(range)] as const)
      : range === "cycle"
        ? (["cache-metrics", "cycle"] as const)
      : (["cache-metrics", "range", range.start, range.end] as const),
} as const;
