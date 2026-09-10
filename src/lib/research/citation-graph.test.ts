// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCitationEdgeKey,
  buildCitationExpansionFingerprint,
  decideCitationExpansion,
  emptyCitationGraphMetrics,
  expandCitationGraphForQuestion,
  normalizeGraphTarget,
  resolveCitationGraphPolicy,
  resolveSeedSciverseUniqueId,
  selectGraphSeeds,
  type CitationExpansionInput,
  type GraphSeedInput,
} from "./citation-graph";
import type { ResearchCandidate, ResearchProviderContext, ResearchSourceProvider, ReadResearchSource } from "./source-provider";

// ─── prisma in-memory mock ──────────────────────────────────

const db = {
  sources: [] as Array<{ id: string; workspaceId: string; canonicalKey: string; metadata: unknown }>,
  edges: [] as Array<Record<string, unknown>>,
  candidates: [] as Array<Record<string, unknown>>,
};

vi.mock("@/lib/db", () => ({
  prisma: {
    researchSource: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; workspaceId_canonicalKey?: { workspaceId: string; canonicalKey: string } } }) => {
        if (where.id) return db.sources.find((row) => row.id === where.id) ?? null;
        const key = where.workspaceId_canonicalKey!;
        return db.sources.find((row) => row.workspaceId === key.workspaceId && row.canonicalKey === key.canonicalKey) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { metadata: unknown } }) => {
        const row = db.sources.find((item) => item.id === where.id);
        if (row) row.metadata = data.metadata;
        return row;
      }),
    },
    researchSourceRelation: {
      findUnique: vi.fn(async ({ where }: { where: { runId_edgeKey: { runId: string; edgeKey: string } } }) =>
        db.edges.find((row) => row.runId === where.runId_edgeKey.runId && row.edgeKey === where.runId_edgeKey.edgeKey) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: `edge-${db.edges.length + 1}` };
        db.edges.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = db.edges.find((item) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { runId: string; targetCanonicalKey: string; targetSourceId: null }; data: { targetSourceId: string } }) => {
        let count = 0;
        for (const row of db.edges) {
          if (row.runId === where.runId && row.targetCanonicalKey === where.targetCanonicalKey && row.targetSourceId == null) {
            row.targetSourceId = data.targetSourceId;
            count += 1;
          }
        }
        return { count };
      }),
    },
    researchSourceCandidate: {
      upsert: vi.fn(async ({ where, create }: { where: { runId_provider_externalId: { runId: string; provider: string; externalId: string } }; create: Record<string, unknown> }) => {
        const key = where.runId_provider_externalId;
        const existing = db.candidates.find((row) => row.runId === key.runId && row.provider === key.provider && row.externalId === key.externalId);
        if (existing) return existing;
        const row = { ...create, id: `cand-${db.candidates.length + 1}`, researchSourceId: null };
        db.candidates.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = db.candidates.find((item) => item.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
        const row = db.candidates.find((item) => item.id === where.id);
        if (row) row.status = data.status;
        return { count: 1 };
      }),
    },
  },
}));

beforeEach(() => {
  db.sources = [];
  db.edges = [];
  db.candidates = [];
  vi.clearAllMocks();
});

// ─── pure: policy / decision / seeds / identity ─────────────

describe("citation graph policy", () => {
  it("quick is strictly bounded: 1 seed, 1 relation, 1 hop, 1 page", () => {
    const policy = resolveCitationGraphPolicy("quick", "computer_science");
    expect(policy).toMatchObject({ maxSeedsPerQuestion: 1, maxRelationsPerSeed: 1, maxHops: 1, maxPagesPerSeedRelation: 1 });
    expect(policy.maxExpandedCandidatesPerQuestion).toBeLessThanOrEqual(4);
  });

  it("deep allows two relations, comprehensive allows a second hop", () => {
    expect(resolveCitationGraphPolicy("deep", "general").maxRelationsPerSeed).toBe(2);
    expect(resolveCitationGraphPolicy("deep", "general").maxHops).toBe(1);
    expect(resolveCitationGraphPolicy("comprehensive", "computer_science").maxHops).toBe(2);
  });

  it("law scales graph budgets down (papers never outrank authoritative web/project)", () => {
    const quick = resolveCitationGraphPolicy("quick", "law");
    const deep = resolveCitationGraphPolicy("deep", "law");
    expect(deep.maxSeedsPerQuestion).toBeLessThan(resolveCitationGraphPolicy("deep", "computer_science").maxSeedsPerQuestion);
    expect(quick.maxSeedsPerQuestion).toBe(1);
  });

  it("unknown domains fall back to the general scale", () => {
    expect(resolveCitationGraphPolicy("deep", "unknown").maxSeedsPerQuestion).toBe(2);
  });
});

describe("citation expansion need", () => {
  const base = { questionText: "MoE 路由方法有哪些改进？", activeEvidenceCount: 3, timeRange: null, maxRelations: 2 };

  it("skips resolved questions with enough independent sources", () => {
    const decision = decideCitationExpansion({ ...base, questionStatus: "resolved", independentSourceCount: 2 });
    expect(decision.needed).toBe(false);
  });

  it("single-source resolved questions expand via citations (independent corroboration)", () => {
    const decision = decideCitationExpansion({ ...base, questionStatus: "resolved", independentSourceCount: 1 });
    expect(decision.needed).toBe(true);
    expect(decision.needs).toContain("single_source_only");
    expect(decision.relations[0]).toBe("citations");
  });

  it("conflicted questions expand via citations (follow-up verification)", () => {
    const decision = decideCitationExpansion({ ...base, questionStatus: "controversial", independentSourceCount: 3 });
    expect(decision.needs).toContain("conflicted_claim");
    expect(decision.relations).toEqual(["citations"]);
  });

  it("unresolved questions expand via references first, then citations", () => {
    const decision = decideCitationExpansion({ ...base, questionStatus: "unresolved", independentSourceCount: 0 });
    expect(decision.needs).toContain("insufficient_direct_evidence");
    expect(decision.relations.slice(0, 2)).toEqual(["references", "citations"]);
  });

  it("origin questions prioritize references", () => {
    const decision = decideCitationExpansion({ ...base, questionStatus: "resolved", independentSourceCount: 2, questionText: "这个方法最早由谁提出？" });
    expect(decision.needs).toContain("missing_original_source");
    expect(decision.relations[0]).toBe("references");
  });

  it("time-sensitive resolved questions look for recent validation", () => {
    const decision = decideCitationExpansion({ ...base, questionStatus: "resolved", independentSourceCount: 2, questionText: "2026 年最新进展是什么？" });
    expect(decision.needs).toContain("needs_recent_validation");
    expect(decision.relations).toEqual(["citations"]);
  });

  it("never expands without any active evidence (no seeds possible)", () => {
    const decision = decideCitationExpansion({ ...base, questionStatus: "unresolved", independentSourceCount: 0, activeEvidenceCount: 0 });
    expect(decision.needed).toBe(false);
  });

  it("truncates relations to the policy maximum", () => {
    const decision = decideCitationExpansion({ ...base, questionStatus: "unresolved", independentSourceCount: 0, maxRelations: 1 });
    expect(decision.relations).toHaveLength(1);
  });
});

function seed(overrides: Partial<GraphSeedInput> = {}): GraphSeedInput {
  return {
    sourceId: "src-1",
    canonicalKey: "doi:10.1/a",
    kind: "academic_paper",
    title: "Paper",
    doi: "10.1/a",
    sciverseUniqueId: "paper:10.1/a",
    isContentAccessible: true,
    activeEvidenceCount: 1,
    year: 2025,
    citationCount: null,
    influentialCitationCount: null,
    fwci: null,
    ...overrides,
  };
}

describe("seed selection", () => {
  it("only selects scholarly sources that contributed active evidence", () => {
    const policy = resolveCitationGraphPolicy("comprehensive", "computer_science");
    const selected = selectGraphSeeds([
      seed({ sourceId: "a", activeEvidenceCount: 2 }),
      seed({ sourceId: "b", kind: "web", activeEvidenceCount: 5 }),
      seed({ sourceId: "c", activeEvidenceCount: 0 }),
    ], policy);
    expect(selected.map((item) => item.sourceId)).toEqual(["a"]);
  });

  it("prefers sciverse-uniqueId seeds and evidence contributors; citation count is a weak signal", () => {
    const policy = resolveCitationGraphPolicy("comprehensive", "computer_science");
    const selected = selectGraphSeeds([
      seed({ sourceId: "no-uid", sciverseUniqueId: null, activeEvidenceCount: 1, citationCount: 100000 }),
      seed({ sourceId: "with-uid", activeEvidenceCount: 1, citationCount: 1 }),
    ], policy);
    expect(selected[0].sourceId).toBe("with-uid");
  });

  it("caps to maxSeedsPerQuestion", () => {
    const policy = resolveCitationGraphPolicy("quick", "general");
    const selected = selectGraphSeeds([seed({ sourceId: "a" }), seed({ sourceId: "b", canonicalKey: "doi:10.1/b", doi: "10.1/b" })], policy);
    expect(selected).toHaveLength(1);
  });
});

describe("graph target identity", () => {
  it("normalizes doi items via the shared DOI rules", () => {
    const target = normalizeGraphTarget({ id: "HTTPS://doi.org/10.1038/S41586-021-03819-2", idType: "doi", title: "T" });
    expect(target.doi).toBe("10.1038/s41586-021-03819-2");
    expect(target.canonicalKey).toBe("doi:10.1038/s41586-021-03819-2");
  });

  it("extracts embedded DOI from paper: unique_ids", () => {
    const target = normalizeGraphTarget({ id: "paper:10.1038/s41586-021-03819-2", idType: "unique_id" });
    expect(target.sciverseUniqueId).toBe("paper:10.1038/s41586-021-03819-2");
    expect(target.doi).toBe("10.1038/s41586-021-03819-2");
    expect(target.canonicalKey).toBe("doi:10.1038/s41586-021-03819-2");
  });

  it("maps arxiv DOIs to an arxiv identity", () => {
    const target = normalizeGraphTarget({ id: "10.48550/arXiv.1706.03762", idType: "doi" });
    expect(target.arxivId).toBe("1706.03762");
  });

  it("keeps unknown id_type provider-scoped without inventing a DOI", () => {
    const target = normalizeGraphTarget({ id: "W123456", idType: "openalex" });
    expect(target.doi).toBeNull();
    expect(target.canonicalKey).toContain("sciverse_relation");
    expect(target.canonicalKey).toContain("openalex:W123456");
  });

  it("produces deterministic edge keys and page fingerprints", () => {
    const a = buildCitationEdgeKey({ sourceId: "s1", relation: "citations", targetCanonicalKey: "doi:10.1/x" });
    const b = buildCitationEdgeKey({ sourceId: "s1", relation: "citations", targetCanonicalKey: "doi:10.1/x" });
    const c = buildCitationEdgeKey({ sourceId: "s2", relation: "citations", targetCanonicalKey: "doi:10.1/x" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    const f1 = buildCitationExpansionFingerprint({ questionId: "q", seedSourceId: "s1", relation: "citations", page: 1, hop: 1 });
    const f2 = buildCitationExpansionFingerprint({ questionId: "q", seedSourceId: "s1", relation: "citations", page: 2, hop: 1 });
    expect(f1).not.toBe(f2);
  });
});

// ─── expansion execution ────────────────────────────────────

function makeContext(): ResearchProviderContext {
  return { userId: "user-1", conversationId: "conv-1", executionId: "exec-1", runId: "run-1", signal: new AbortController().signal };
}

const targetPaper = {
  uniqueId: "paper:10.1/target",
  docId: "d".repeat(64),
  title: "Target Paper",
  doi: "10.1/target",
  isContentAccessible: true,
  abstractPreview: "Target abstract.",
};

function expansionInput(
  overrides: Partial<CitationExpansionInput> = {},
  toolResponses: Record<string, unknown> = {},
  options: { readable?: boolean } = {},
) {
  const toolCalls: Array<{ toolId: string; args: Record<string, unknown> }> = [];
  const runTool = vi.fn(async (_ctx: ResearchProviderContext, toolId: string, args: Record<string, unknown>) => {
    toolCalls.push({ toolId, args });
    const response = toolResponses[toolId];
    if (response === undefined) return null;
    return response as Record<string, unknown>;
  });
  const reads: ResearchCandidate[] = [];
  const provider: ResearchSourceProvider = {
    search: vi.fn(async () => []),
    read: vi.fn(async (_ctx, candidate) => {
      reads.push(candidate);
      if (options.readable === false) return null;
      return {
        candidate,
        title: candidate.title,
        content: "target body text",
        excerpt: "target body text",
        locator: { kind: "sciverse", docId: "d".repeat(64), offset: 0 },
        sourceVersion: null,
        metadata: candidate.metadata,
      } satisfies ReadResearchSource;
    }),
  };
  const ingest = vi.fn(async () => null);
  const counters = { searchCalls: 0, fetchCalls: 0, sourceCount: 0 };
  const input: CitationExpansionInput = {
    userId: "user-1",
    workspaceId: "ws-1",
    runId: "run-1",
    questionId: "q-1",
    questionText: "MoE 路由方法有哪些改进？",
    seeds: [seed()],
    relations: ["citations"],
    policy: resolveCitationGraphPolicy("deep", "computer_science"),
    providerContext: makeContext(),
    provider,
    runTool,
    processedFingerprints: new Set(),
    graphToolCallsUsed: 0,
    tryReserve: (counter) => {
      counters[counter] += 1;
      return true;
    },
    ingest: ingest as unknown as CitationExpansionInput["ingest"],
    ...overrides,
  };
  return { input, toolCalls, reads, ingest, counters };
}

describe("citation graph expansion execution", () => {
  it("persists edges idempotently without creating evidence from relation items", async () => {
    const { input, ingest } = expansionInput({}, {
      "sciverse.paper_relations": { items: [{ id: "10.1/target", id_type: "doi", title: "Target" }], total_count: 1, page: 1, page_size: 10, total_pages: 1, hasMore: false },
      // identity resolution 失败：target 停留在 edge-only，不创建 candidate。
      "sciverse.search": { papers: [] },
    }, { readable: false });
    const first = await expandCitationGraphForQuestion(input);
    expect(db.edges).toHaveLength(1);
    expect(db.edges[0]).toMatchObject({ relation: "citations", provider: "sciverse", hop: 1 });
    expect(first.metrics.graphEdgesDiscovered).toBe(1);
    // relation item 不是 Evidence：没有任何 read/ingest。
    expect(ingest).not.toHaveBeenCalled();

    // durable retry：同一 fingerprint 不再调用，不再产生重复 edge。
    const second = await expandCitationGraphForQuestion({
      ...input,
      processedFingerprints: new Set(first.processedFingerprints),
    });
    expect(second.metrics.graphEdgesDiscovered).toBe(0);
    expect(db.edges).toHaveLength(1);
    expect((input.runTool as ReturnType<typeof vi.fn>).mock.calls.filter((call) => call[1] === "sciverse.paper_relations")).toHaveLength(1);
  });

  it("keeps two edges when two seeds cite the same canonical target", async () => {
    const seedB = seed({ sourceId: "src-2", canonicalKey: "doi:10.1/b", doi: "10.1/b", sciverseUniqueId: "paper:10.1/b" });
    const { input } = expansionInput({ seeds: [seed(), seedB] }, {
      "sciverse.paper_relations": { items: [{ id: "10.1/target", id_type: "doi" }], total_count: 1, page: 1, page_size: 10, total_pages: 1, hasMore: false },
      "sciverse.search": { papers: [] },
    }, { readable: false });
    await expandCitationGraphForQuestion(input);
    expect(db.edges).toHaveLength(2);
    expect(new Set(db.edges.map((edge) => edge.sourceId)).size).toBe(2);
    expect(new Set(db.edges.map((edge) => edge.targetCanonicalKey)).size).toBe(1);
  });

  it("links edges to an existing canonical source instead of refetching it", async () => {
    db.sources.push({ id: "src-target", workspaceId: "ws-1", canonicalKey: "doi:10.1/target", metadata: {} });
    const { input, reads } = expansionInput({}, {
      "sciverse.paper_relations": { items: [{ id: "10.1/target", id_type: "doi" }], total_count: 1, page: 1, page_size: 10, total_pages: 1, hasMore: false },
    }, { readable: false });
    const output = await expandCitationGraphForQuestion(input);
    expect(db.edges[0].targetSourceId).toBe("src-target");
    expect(reads).toHaveLength(0);
    expect(output.metrics.graphDuplicateTargets).toBe(1);
    expect(db.candidates).toHaveLength(0);
  });

  it("resolves targets with a bounded exact-DOI search and reads them through the provider", async () => {
    const { input, toolCalls, ingest } = expansionInput({}, {
      "sciverse.paper_relations": { items: [{ id: "10.1/target", id_type: "doi", title: "Target" }], total_count: 1, page: 1, page_size: 10, total_pages: 1, hasMore: false },
      "sciverse.search": { papers: [{ ...targetPaper, doi: "10.1/other" }, targetPaper] },
    });
    (ingest as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      source: { id: "src-target", canonicalKey: "doi:10.1/target" },
      snapshot: { id: "snap-1" },
      evidences: [{ id: "ev-1" }],
      rawContentPersisted: true,
    }));

    const output = await expandCitationGraphForQuestion(input);

    // identity resolution 只接受 DOI 精确匹配（10.1/other 被跳过）。
    const searchCall = toolCalls.find((call) => call.toolId === "sciverse.search");
    expect(searchCall?.args).toMatchObject({ query: "10.1/target", pageSize: 3 });
    expect(db.candidates).toHaveLength(1);
    expect(db.candidates[0]).toMatchObject({ provider: "sciverse", externalId: "10.1/target", status: "fetched", researchSourceId: "src-target" });
    expect((db.candidates[0].metadata as Record<string, unknown>).discovery).toBe("sciverse.paper_relations");
    expect(output.metrics.graphSourcesFetched).toBe(1);
    expect(output.metrics.graphEvidenceAdded).toBe(1);
    // edge 回链到归一化后的 target source。
    expect(db.edges[0].targetSourceId).toBe("src-target");
  });

  it("constructs arxiv candidates directly from arXiv DOIs without a search call", async () => {
    const { input, toolCalls } = expansionInput({}, {
      "sciverse.paper_relations": { items: [{ id: "10.48550/arXiv.1706.03762", id_type: "doi" }], total_count: 1, page: 1, page_size: 10, total_pages: 1, hasMore: false },
    });
    await expandCitationGraphForQuestion(input);
    expect(toolCalls.filter((call) => call.toolId === "sciverse.search")).toHaveLength(0);
    expect(db.candidates[0]).toMatchObject({ provider: "arxiv", externalId: "1706.03762", url: "https://arxiv.org/abs/1706.03762" });
  });

  it("never pages through a large total_pages relation list", async () => {
    const { input, toolCalls } = expansionInput({}, {
      "sciverse.paper_relations": { items: [{ id: "10.1/target", id_type: "doi" }], total_count: 340000, page: 1, page_size: 10, total_pages: 34000, hasMore: true },
      "sciverse.search": { papers: [] },
    });
    await expandCitationGraphForQuestion(input);
    expect(toolCalls.filter((call) => call.toolId === "sciverse.paper_relations")).toHaveLength(1);
  });

  it("degrades cleanly when the relations call fails (no run failure)", async () => {
    const { input } = expansionInput({}, {
      "sciverse.paper_relations": { error: "SCIVERSE_RATE_LIMITED", retryAfterMs: 3000 },
    });
    const output = await expandCitationGraphForQuestion(input);
    expect(output.metrics.graphEdgesDiscovered).toBe(0);
    expect(db.edges).toHaveLength(0);
    expect(db.candidates).toHaveLength(0);
  });

  it("stops at the graph tool-call budget", async () => {
    const { input } = expansionInput({ graphToolCallsUsed: 20 }, {
      "sciverse.paper_relations": { items: [], total_count: 0, page: 1, page_size: 10, total_pages: 0, hasMore: false },
    });
    const output = await expandCitationGraphForQuestion(input);
    expect((input.runTool as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(output.metrics.graphBudgetStops).toBeGreaterThan(0);
  });

  it("comprehensive policy expands a second hop from fetched sources", async () => {
    const { input, ingest } = expansionInput({ policy: resolveCitationGraphPolicy("comprehensive", "computer_science") }, {
      "sciverse.paper_relations": { items: [{ id: "10.1/target", id_type: "doi" }], total_count: 1, page: 1, page_size: 15, total_pages: 1, hasMore: false },
      "sciverse.search": { papers: [targetPaper] },
    });
    (ingest as ReturnType<typeof vi.fn>).mockImplementation(async ({ read }: { read: ReadResearchSource }) => ({
      source: { id: `src-${read.candidate.externalId}`, canonicalKey: `doi:${read.candidate.externalId}` },
      snapshot: { id: "snap-1" },
      evidences: [{ id: "ev-1" }],
      rawContentPersisted: true,
    }));
    const output = await expandCitationGraphForQuestion(input);
    const hops = new Set(db.edges.map((edge) => edge.hop));
    expect(hops.has(1)).toBe(true);
    expect(hops.has(2)).toBe(true);
    expect(output.metrics.graphSeedsExpanded).toBe(2);
  });
});

describe("seed identity resolution", () => {
  it("merges a resolved uniqueId into the existing source metadata (no duplicate source)", async () => {
    db.sources.push({ id: "src-1", workspaceId: "ws-1", canonicalKey: "doi:10.1/a", metadata: { provider: "crossref" } });
    const runTool = vi.fn(async () => ({ papers: [targetPaper, { uniqueId: "paper:10.1/a", doi: "10.1/a", title: "Seed" }] }));
    const uniqueId = await resolveSeedSciverseUniqueId(runTool, makeContext(), seed({ sciverseUniqueId: null }));
    expect(uniqueId).toBe("paper:10.1/a");
    expect(db.sources).toHaveLength(1);
    expect((db.sources[0].metadata as Record<string, unknown>).sciverseUniqueId).toBe("paper:10.1/a");
    expect((db.sources[0].metadata as Record<string, unknown>).provider).toBe("crossref");
  });

  it("returns null without a DOI or on resolution failure, without touching the source", async () => {
    const runTool = vi.fn(async () => ({ papers: [] }));
    await expect(resolveSeedSciverseUniqueId(runTool, makeContext(), seed({ sciverseUniqueId: null, doi: null }))).resolves.toBeNull();
    expect(runTool).not.toHaveBeenCalled();
    await expect(resolveSeedSciverseUniqueId(runTool, makeContext(), seed({ sciverseUniqueId: null }))).resolves.toBeNull();
    expect(db.sources).toHaveLength(0);
  });
});

describe("metrics", () => {
  it("starts empty", () => {
    expect(emptyCitationGraphMetrics()).toMatchObject({ graphSeedsExpanded: 0, graphEdgesDiscovered: 0, graphBudgetStops: 0 });
  });
});
