import { describe, expect, it, vi } from "vitest";
import type { ToolRunner } from "@/lib/agent/tools/tool-runner";
import type { AcademicSourceAdapter } from "./academic-adapters";
import { createToolBackedResearchSourceProvider, type ResearchCandidate, type ResearchProviderContext } from "./source-provider";

function createContext(overrides: Partial<ResearchProviderContext> = {}): ResearchProviderContext {
  return {
    userId: "user-1",
    conversationId: "conv-1",
    executionId: "exec-1",
    runId: "run-1",
    signal: new AbortController().signal,
    question: "注意力机制如何提升序列建模？",
    ...overrides,
  };
}

function succeededToolRunner(responses: Record<string, unknown>): { runner: ToolRunner; calls: Array<{ toolId: string; args: Record<string, unknown>; context: Record<string, unknown> }> } {
  const calls: Array<{ toolId: string; args: Record<string, unknown>; context: Record<string, unknown> }> = [];
  const runner = {
    run: vi.fn(async (request: { call: { toolId: string; arguments: Record<string, unknown> }; context: Record<string, unknown> }) => {
      calls.push({ toolId: request.call.toolId, args: request.call.arguments, context: request.context });
      const summary = responses[request.call.toolId];
      if (summary === undefined) return { status: "failed" as const, error: { code: "not_mocked", message: "not mocked" } };
      return { status: "succeeded" as const, executionId: "tool-exec-1", summary };
    }),
  } as unknown as ToolRunner;
  return { runner, calls };
}

function legacyAdapter(provider: "openalex" | "crossref" | "semantic_scholar" | "pubmed"): AcademicSourceAdapter & { searchCalls: number } {
  const adapter = {
    provider,
    searchCalls: 0,
    async search(): Promise<ResearchCandidate[]> {
      adapter.searchCalls += 1;
      return [{
        provider,
        kind: "academic_paper",
        externalId: "10.1000/legacy",
        title: `${provider} paper`,
        url: "https://doi.org/10.1000/legacy",
        metadata: { doi: "10.1000/legacy" },
      }];
    },
    async read(): Promise<null> {
      return null;
    },
  };
  return adapter;
}

const sciversePaper = {
  uniqueId: "paper:1",
  docId: "a".repeat(64),
  title: "Attention Is All You Need",
  authors: ["Ashish Vaswani"],
  abstractPreview: "We propose the Transformer.",
  doi: "10.48550/arXiv.1706.03762",
  venue: "NeurIPS",
  year: 2017,
  citationCount: 100000,
  influentialCitationCount: 5000,
  fwci: 120.5,
  isOpenAccess: true,
  isContentAccessible: true,
  url: "https://arxiv.org/abs/1706.03762",
};

describe("research source provider · sciverse channel", () => {
  it("invokes tools as a system orchestrator without a user-facing skill approval policy", async () => {
    const { runner, calls } = succeededToolRunner({
      "sciverse.search": { papers: [sciversePaper], totalCount: 1, page: 1, pageSize: 10, hasMore: false },
    });
    const provider = createToolBackedResearchSourceProvider({ toolRunner: runner, academicAdapters: [] });

    await provider.search(createContext(), "attention is all you need");

    // 回归：Research durable Run 没有人工审批路径；若 context 带 skillId，
    // literature-review 的 ask_first 策略会让全部工具通道 pending_approval 并静默回退。
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.context).not.toHaveProperty("skillId");
    }
  });

  it("uses sciverse as primary academic discovery and skips legacy adapters", async () => {
    const { runner } = succeededToolRunner({
      "sciverse.search": { papers: [sciversePaper], totalCount: 1, page: 1, pageSize: 10, hasMore: false },
    });
    const adapters = [legacyAdapter("openalex"), legacyAdapter("crossref"), legacyAdapter("semantic_scholar"), legacyAdapter("pubmed")];
    const provider = createToolBackedResearchSourceProvider({ toolRunner: runner, academicAdapters: adapters });

    const candidates = await provider.search(createContext(), "attention is all you need");

    const sciverseCandidates = candidates.filter((candidate) => candidate.provider === "sciverse");
    expect(sciverseCandidates).toHaveLength(1);
    expect(sciverseCandidates[0]).toMatchObject({
      kind: "academic_paper",
      externalId: "10.48550/arxiv.1706.03762",
      title: "Attention Is All You Need",
      url: "https://arxiv.org/abs/1706.03762",
    });
    expect(sciverseCandidates[0].metadata).toMatchObject({
      doi: "10.48550/arxiv.1706.03762",
      docId: "a".repeat(64),
      uniqueId: "paper:1",
      year: 2017,
      venue: "NeurIPS",
      citationCount: 100000,
      influentialCitationCount: 5000,
      fwci: 120.5,
      isOpenAccess: true,
      isContentAccessible: true,
    });
    for (const adapter of adapters) expect(adapter.searchCalls).toBe(0);
  });

  it("falls back to legacy adapters when sciverse is not configured", async () => {
    const { runner } = succeededToolRunner({
      "sciverse.search": { error: "SCIVERSE_NOT_CONFIGURED", message: "平台学术检索未配置或暂不可用" },
    });
    const adapters = [legacyAdapter("openalex")];
    const provider = createToolBackedResearchSourceProvider({ toolRunner: runner, academicAdapters: adapters });

    const candidates = await provider.search(createContext(), "attention");

    expect(adapters[0].searchCalls).toBe(1);
    expect(candidates.some((candidate) => candidate.provider === "openalex")).toBe(true);
    expect(candidates.some((candidate) => candidate.provider === "sciverse")).toBe(false);
  });

  it.each([
    ["rate limited", { error: "SCIVERSE_RATE_LIMITED", retryAfterMs: 3000 }],
    ["unavailable", { error: "SCIVERSE_UNAVAILABLE", recoverable: true }],
    ["empty result", { papers: [], totalCount: 0, page: 1, pageSize: 10, hasMore: false }],
  ])("falls back to legacy adapters when sciverse is %s", async (_label, sciverseResult) => {
    const { runner } = succeededToolRunner({ "sciverse.search": sciverseResult });
    const adapters = [legacyAdapter("crossref")];
    const provider = createToolBackedResearchSourceProvider({ toolRunner: runner, academicAdapters: adapters });

    const candidates = await provider.search(createContext(), "attention");

    expect(adapters[0].searchCalls).toBe(1);
    expect(candidates.some((candidate) => candidate.provider === "crossref")).toBe(true);
  });

  it("keeps web and arxiv channels untouched", async () => {
    const { runner } = succeededToolRunner({
      "web.search": { sources: [{ url: "https://example.com/post", title: "Blog post" }] },
      "arxiv.search": { results: [{ arxivId: "1706.03762", title: "Attention Is All You Need" }] },
      "sciverse.search": { papers: [sciversePaper] },
    });
    const provider = createToolBackedResearchSourceProvider({ toolRunner: runner, academicAdapters: [] });

    const candidates = await provider.search(createContext(), "attention");

    expect(candidates.some((candidate) => candidate.provider === "web" && candidate.url === "https://example.com/post")).toBe(true);
    expect(candidates.some((candidate) => candidate.provider === "arxiv" && candidate.externalId === "1706.03762")).toBe(true);
    expect(candidates.some((candidate) => candidate.provider === "sciverse")).toBe(true);
  });

  it("isolates arxiv degradation: failed arxiv.search never fails the whole channel mix", async () => {
    const { runner } = succeededToolRunner({
      "web.search": { sources: [{ url: "https://example.com/post", title: "Blog post" }] },
      // arxiv.search 未 mock → ToolRunner failed（模拟新服务器出口超时后的有界失败）
      "sciverse.search": { papers: [sciversePaper] },
    });
    const provider = createToolBackedResearchSourceProvider({ toolRunner: runner, academicAdapters: [] });

    const candidates = await provider.search(createContext(), "attention");

    expect(candidates.some((candidate) => candidate.provider === "arxiv")).toBe(false);
    expect(candidates.some((candidate) => candidate.provider === "web")).toBe(true);
    expect(candidates.some((candidate) => candidate.provider === "sciverse")).toBe(true);
  });

  it("scopes semantic search to the selected paper docId and reads bounded slices", async () => {
    const { runner, calls } = succeededToolRunner({
      "sciverse.semantic_search": {
        hits: [
          { chunkId: "chunk-1", docId: "a".repeat(64), title: "Attention Is All You Need", score: 0.83, offset: 1200, pageNo: 3, sourceType: "pdf", chunk: "The Transformer uses self-attention." },
          { chunkId: "chunk-2", docId: "a".repeat(64), title: "Attention Is All You Need", score: 0.71, offset: 5400, chunk: "Multi-head attention allows..." },
        ],
        count: 2,
        query: "注意力机制如何提升序列建模？",
      },
      "sciverse.read": { docId: "a".repeat(64), offset: 1200, text: "The Transformer uses self-attention, reading bounded context.", returnedChars: 60, nextOffset: 2800, more: true },
    });
    const provider = createToolBackedResearchSourceProvider({ toolRunner: runner, academicAdapters: [] });
    const candidate = sciverseCandidateFixture();

    const read = await provider.read(createContext(), candidate);

    const semanticCall = calls.find((call) => call.toolId === "sciverse.semantic_search");
    expect(semanticCall?.args).toMatchObject({ query: "注意力机制如何提升序列建模？", topK: 4, filters: { docIds: ["a".repeat(64)] } });
    const readCalls = calls.filter((call) => call.toolId === "sciverse.read");
    expect(readCalls.length).toBeGreaterThan(0);
    for (const call of readCalls) {
      expect(call.args.docId).toBe("a".repeat(64));
      expect(call.args.limit).toBeLessThanOrEqual(4000);
      expect(typeof call.args.offset).toBe("number");
    }
    expect(read).not.toBeNull();
    expect(read?.evidenceType).toBe("direct_quote");
    expect(read?.slices?.length).toBeGreaterThan(0);
    const firstSlice = read?.slices?.[0];
    expect(firstSlice?.locator).toMatchObject({ kind: "sciverse", docId: "a".repeat(64), chunkId: "chunk-1", offset: 1200, pageNo: 3 });
    expect(firstSlice?.provenance).toMatchObject({ provider: "sciverse", retrievalMethod: "sciverse.read", semanticScore: 0.83 });
    expect(typeof (firstSlice?.provenance as Record<string, unknown>).queryHash).toBe("string");
    expect(JSON.stringify(firstSlice?.provenance)).not.toContain("注意力机制如何提升序列建模？");
    expect(read?.snapshotScope).toMatchObject({ type: "bounded_evidence_slices", provider: "sciverse", docId: "a".repeat(64) });
    expect(read?.content.length).toBeLessThanOrEqual(4 * 2000 + 8);
  });

  it("falls back to the semantic hit chunk when bounded read fails", async () => {
    const { runner } = succeededToolRunner({
      "sciverse.semantic_search": {
        hits: [{ chunkId: "chunk-1", docId: "a".repeat(64), title: "t", score: 0.5, offset: 10, chunk: "chunk text only" }],
        count: 1,
        query: "q",
      },
      "sciverse.read": { error: "SCIVERSE_CONTENT_UNAVAILABLE", recoverable: true },
    });
    const provider = createToolBackedResearchSourceProvider({ toolRunner: runner, academicAdapters: [] });

    const read = await provider.read(createContext(), sciverseCandidateFixture());

    expect(read?.slices).toHaveLength(1);
    expect(read?.slices?.[0].excerpt).toBe("chunk text only");
    expect(read?.slices?.[0].provenance).toMatchObject({ retrievalMethod: "sciverse.semantic_search" });
  });

  it("degrades to metadata-only evidence without fabricating full text", async () => {
    const { runner, calls } = succeededToolRunner({});
    const provider = createToolBackedResearchSourceProvider({ toolRunner: runner, academicAdapters: [] });
    const candidate = sciverseCandidateFixture({ isContentAccessible: false });

    const read = await provider.read(createContext(), candidate);

    expect(calls.filter((call) => call.toolId === "sciverse.semantic_search")).toHaveLength(0);
    expect(calls.filter((call) => call.toolId === "sciverse.read")).toHaveLength(0);
    expect(read?.content).toBe("We propose the Transformer.");
    expect(read?.locator).toMatchObject({ kind: "sciverse", docId: "a".repeat(64), uniqueId: "paper:1" });
    expect(read?.snapshotScope).toMatchObject({ type: "metadata_only", retrievalMethod: "sciverse.search" });
  });

  it("returns null when the paper has neither accessible content nor abstract", async () => {
    const { runner } = succeededToolRunner({});
    const provider = createToolBackedResearchSourceProvider({ toolRunner: runner, academicAdapters: [] });
    const candidate = sciverseCandidateFixture({ isContentAccessible: false, abstractPreview: null });

    await expect(provider.read(createContext(), candidate)).resolves.toBeNull();
  });

  it("never sends an empty docIds scope", async () => {
    const { runner, calls } = succeededToolRunner({
      "sciverse.semantic_search": { hits: [], count: 0, query: "q" },
    });
    const provider = createToolBackedResearchSourceProvider({ toolRunner: runner, academicAdapters: [] });
    const candidate = sciverseCandidateFixture();

    await provider.read(createContext(), candidate);

    const semanticCall = calls.find((call) => call.toolId === "sciverse.semantic_search");
    const docIds = (semanticCall?.args.filters as Record<string, unknown> | undefined)?.docIds;
    expect(Array.isArray(docIds)).toBe(true);
    expect((docIds as string[]).length).toBe(1);
  });
});

function sciverseCandidateFixture(overrides: Record<string, unknown> = {}): ResearchCandidate {
  return {
    provider: "sciverse",
    kind: "academic_paper",
    externalId: "10.48550/arxiv.1706.03762",
    title: "Attention Is All You Need",
    url: "https://arxiv.org/abs/1706.03762",
    metadata: {
      doi: "10.48550/arxiv.1706.03762",
      docId: "a".repeat(64),
      uniqueId: "paper:1",
      authors: ["Ashish Vaswani"],
      year: 2017,
      venue: "NeurIPS",
      isContentAccessible: true,
      abstractPreview: "We propose the Transformer.",
      ...overrides,
    },
  };
}
