// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@/lib/agent/tool-executor";
import { sciversePaperRelations, sciverseRead, sciverseResource, sciverseSearch, sciverseSemanticSearch } from "./handlers";
import { invalidateSciverseCatalogCache } from "./catalog";

const ctx: ToolExecutionContext = { userId: "user-1", conversationId: "conv-1" };

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const metaSearchPayload = {
  results: [
    {
      unique_id: "paper:1",
      doc_id: "a".repeat(64),
      title: "Attention Is All You Need",
      author: [{ name: "Ashish Vaswani" }],
      doi: "10.48550/arXiv.1706.03762",
      publication_published_year: 2017,
      is_content_accessible: true,
    },
  ],
  total_count: "1",
  page: 1,
  page_size: 10,
  total_pages: 1,
};

const agenticPayload = {
  hits: [
    { chunk_id: "c1", doc_id: "a".repeat(64), title: "T", score: 0.9, offset: 42, chunk: "evidence text" },
  ],
};

beforeEach(() => {
  process.env.SCIVERSE_API_TOKEN = "scv_test_token";
});

afterEach(() => {
  delete process.env.SCIVERSE_API_TOKEN;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("configuration gate", () => {
  it("returns SCIVERSE_NOT_CONFIGURED for all three handlers when the token is missing", async () => {
    delete process.env.SCIVERSE_API_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sciverseSearch(ctx, { query: "q" })).toEqual({
      error: "SCIVERSE_NOT_CONFIGURED",
      message: "平台学术检索未配置或暂不可用",
    });
    expect(await sciverseSemanticSearch(ctx, { query: "q" })).toMatchObject({ error: "SCIVERSE_NOT_CONFIGURED" });
    expect(await sciverseRead(ctx, { docId: "d" })).toMatchObject({ error: "SCIVERSE_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sciverse.search handler", () => {
  it("sends the mapped wire body and returns normalized papers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(metaSearchPayload));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseSearch(ctx, {
      query: "attention",
      authors: ["Vaswani"],
      yearFrom: 2017,
      pageSize: 10,
      sortByYear: "desc",
    }) as { papers: Array<Record<string, unknown>>; totalCount: number };

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sciverse.space/meta-search");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      collection: "papers",
      query: "attention",
      page: 1,
      page_size: 10,
    });
    // query + sortByYear=desc must not emit a sort clause (conservative).
    expect(body.sort).toBeUndefined();
    expect(body.filters).toEqual([
      { field: "author", operator: "FILTER_OP_IN", value: ["Vaswani"] },
      { field: "publication_published_year", operator: "FILTER_OP_GTE", value: 2017 },
    ]);

    expect(result.totalCount).toBe(1);
    expect(result.papers[0]).toMatchObject({
      uniqueId: "paper:1",
      docId: "a".repeat(64),
      isContentAccessible: true,
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani"],
      url: "https://doi.org/10.48550/arXiv.1706.03762",
    });
  });

  it("rejects invalid boost values instead of silently clamping", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseSearch(ctx, { query: "q", freshnessBoost: "EXTREME" });
    expect(result).toMatchObject({ error: "SCIVERSE_INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid sortByYear values", async () => {
    const result = await sciverseSearch(ctx, { sortByYear: "sideways" });
    expect(result).toMatchObject({ error: "SCIVERSE_INVALID_REQUEST" });
  });
});

describe("sciverse.semantic_search handler", () => {
  it("translates quality mode and sends filters including the doc_id hard scope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(agenticPayload));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseSemanticSearch(ctx, {
      query: "  how do transformers handle long context  ",
      mode: "quality",
      topK: 30,
      filters: {
        lang: "en",
        yearFrom: 2020,
        docIds: ["a".repeat(64), "b".repeat(64), "a".repeat(64)],
      },
    }) as { hits: Array<Record<string, unknown>>; count: number; query: string };

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toMatchObject({
      query: "how do transformers handle long context",
      top_k: 30,
      retrieval: "hybrid",
      sub_queries: 3,
    });
    expect(body.mode).toBeUndefined();
    expect(body.filters).toEqual({
      lang: "en",
      publication_published_year: { gte: 2020 },
      doc_id: ["a".repeat(64), "b".repeat(64)],
    });
    expect(result.count).toBe(1);
    expect(result.hits[0]).toMatchObject({ chunkId: "c1", offset: 42, chunk: "evidence text" });
    // Abstract is intentionally not surfaced alongside chunk text.
    expect(result.hits[0].abstract).toBeUndefined();
  });

  it("rejects an empty query and an invalid mode", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sciverseSemanticSearch(ctx, { query: "   " })).toMatchObject({ error: "SCIVERSE_INVALID_REQUEST" });
    expect(await sciverseSemanticSearch(ctx, { query: "q", mode: "ultra" })).toMatchObject({ error: "SCIVERSE_INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns empty hits for an explicit empty docIds array without any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseSemanticSearch(ctx, { query: "q", filters: { docIds: [] } });
    expect(result).toMatchObject({ hits: [], count: 0, scopedToEmptyCorpus: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects docIds beyond the 1000 hard-scope cap", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const docIds = Array.from({ length: 1001 }, (_, i) => `doc-${i}`);
    const result = await sciverseSemanticSearch(ctx, { query: "q", filters: { docIds } });
    expect(result).toMatchObject({ error: "SCIVERSE_SCOPE_TOO_LARGE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("truncates queries beyond 4096 characters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ hits: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await sciverseSemanticSearch(ctx, { query: ` ${"x".repeat(5000)} ` });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.query).toHaveLength(4096);
  });
});

describe("sciverse.read handler", () => {
  it("sends doc_id/offset/limit as query params and parses the bounded slice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ text: "chunk of text", chars_returned: 13, text_length: 9000, next_offset: 1213, more: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseRead(ctx, { docId: "a".repeat(64), offset: 13, limit: 1200 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.sciverse.space/content?doc_id=${"a".repeat(64)}&offset=13&limit=1200`);
    expect(init.method).toBe("GET");
    expect(result).toMatchObject({
      docId: "a".repeat(64),
      offset: 13,
      text: "chunk of text",
      returnedChars: 13,
      totalLength: 9000,
      nextOffset: 1213,
      more: true,
    });
  });

  it("applies default offset/limit and clamps the limit to 4000", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: "t" }));
    vi.stubGlobal("fetch", fetchMock);
    await sciverseRead(ctx, { docId: "d", limit: 99999 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.sciverse.space/content?doc_id=d&offset=0&limit=4000");
  });

  it("requires docId", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sciverseRead(ctx, {})).toMatchObject({ error: "SCIVERSE_INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps 404 to a recoverable SCIVERSE_CONTENT_UNAVAILABLE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: "NOT_FOUND", message: "no full text" }, 404));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseRead(ctx, { docId: "d" });
    expect(result).toMatchObject({ error: "SCIVERSE_CONTENT_UNAVAILABLE", recoverable: true, docId: "d" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps empty text to a recoverable SCIVERSE_CONTENT_UNAVAILABLE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: "  ", bytes_returned: 0, next_offset: 0, more: false }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseRead(ctx, { docId: "d" });
    expect(result).toMatchObject({ error: "SCIVERSE_CONTENT_UNAVAILABLE", recoverable: true });
  });
});

describe("error mapping and logging hygiene", () => {
  it.each([
    [401, "SCIVERSE_AUTH_FAILED"],
    [400, "SCIVERSE_INVALID_REQUEST"],
    [404, "SCIVERSE_NOT_FOUND"],
  ] as const)("maps HTTP %i to %s without retrying", async (status, code) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: "X", message: "m", request_id: "req-9" }, status));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseSearch(ctx, { query: "q" });
    expect(result).toMatchObject({ error: code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 429 to SCIVERSE_RATE_LIMITED with retryAfterMs and no retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ code: "RATE_LIMITED", message: "quota" }, 429, { "retry-after": "5" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseSearch(ctx, { query: "q" });
    expect(result).toMatchObject({ error: "SCIVERSE_RATE_LIMITED", retryAfterMs: 5_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 503 once and then returns recoverable SCIVERSE_UNAVAILABLE", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: "BOOM", message: "x" }, 503));
      vi.stubGlobal("fetch", fetchMock);
      const promise = sciverseSemanticSearch(ctx, { query: "q" });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;
      expect(result).toMatchObject({ error: "SCIVERSE_UNAVAILABLE", recoverable: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers when the retry succeeds", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ code: "BOOM", message: "x" }, 500))
        .mockResolvedValueOnce(jsonResponse(metaSearchPayload));
      vi.stubGlobal("fetch", fetchMock);
      const promise = sciverseSearch(ctx, { query: "q" });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = (await promise) as { papers: unknown[] };
      expect(result.papers).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never exposes the token in returned error objects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: "X", message: "m" }, 500));
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    try {
      const promise = sciverseSearch(ctx, { query: "q" });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;
      expect(JSON.stringify(result)).not.toContain("scv_test_token");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sciverse.paper_relations handler", () => {
  const relationsPayload = {
    items: [
      { id: "10.48550/arXiv.1706.03762", id_type: "doi", title: "Attention Is All You Need" },
      { id: "paper:internal-9", id_type: "sciverse_internal" },
      { id_type: "doi" }, // malformed: no id → dropped
    ],
    total_count: 3,
    page: 1,
    page_size: 10,
    total_pages: 1,
  };

  it("sends the wire enum and returns normalized items with pagination", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(relationsPayload));
    vi.stubGlobal("fetch", fetchMock);
    const result = (await sciversePaperRelations(ctx, {
      uniqueId: "paper:10.1038/s41586-021-03819-2",
      relation: "references",
    })) as { items: Array<Record<string, unknown>>; totalCount: number; hasMore: boolean; relation: string };

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sciverse.space/meta-paper-relations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      unique_id: "paper:10.1038/s41586-021-03819-2",
      relation: "REFERENCES",
      page: 1,
      page_size: 10,
    });
    expect(result.relation).toBe("references");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ id: "10.48550/arXiv.1706.03762", idType: "doi", title: "Attention Is All You Need" });
    // Unknown id_type is preserved verbatim (provider-scoped), never guessed as DOI.
    expect(result.items[1]).toEqual({ id: "paper:internal-9", idType: "sciverse_internal" });
    expect(result.totalCount).toBe(3);
    expect(result.hasMore).toBe(false);
  });

  it("maps citations and related_works to the wire enums", async () => {
    for (const [agent, wire] of [["citations", "CITATIONS"], ["related_works", "RELATED_WORKS"]] as const) {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], total_count: 0, page: 1, page_size: 10, total_pages: 0 }));
      vi.stubGlobal("fetch", fetchMock);
      const result = (await sciversePaperRelations(ctx, { uniqueId: "paper:x", relation: agent })) as { items: unknown[]; hasMore: boolean };
      expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)).relation).toBe(wire);
      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
    }
  });

  it("clamps page/pageSize to the bounded window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], total_count: 0, page: 20, page_size: 50, total_pages: 40 }));
    vi.stubGlobal("fetch", fetchMock);
    await sciversePaperRelations(ctx, { uniqueId: "paper:x", relation: "citations", page: 999, pageSize: 500 });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.page).toBe(20);
    expect(body.page_size).toBe(50);
  });

  it("rejects missing uniqueId and unknown relation without hitting the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sciversePaperRelations(ctx, { relation: "citations" })).toMatchObject({ error: "SCIVERSE_INVALID_REQUEST" });
    expect(await sciversePaperRelations(ctx, { uniqueId: "paper:x", relation: "CITATIONS" })).toMatchObject({ error: "SCIVERSE_INVALID_REQUEST" });
    expect(await sciversePaperRelations(ctx, { uniqueId: "paper:x", relation: "cited_by" })).toMatchObject({ error: "SCIVERSE_INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns SCIVERSE_NOT_CONFIGURED without a token", async () => {
    delete process.env.SCIVERSE_API_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sciversePaperRelations(ctx, { uniqueId: "paper:x", relation: "citations" })).toMatchObject({ error: "SCIVERSE_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps 404 to recoverable SCIVERSE_NOT_FOUND and 429 to SCIVERSE_RATE_LIMITED", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: "NOT_FOUND", message: "paper not found" }, 404));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sciversePaperRelations(ctx, { uniqueId: "paper:missing", relation: "citations" })).toMatchObject({ error: "SCIVERSE_NOT_FOUND", recoverable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset().mockResolvedValue(jsonResponse({ code: "RATE_LIMITED", message: "too many" }, 429, { "retry-after": "2" }));
    const rateLimited = await sciversePaperRelations(ctx, { uniqueId: "paper:x", relation: "citations" });
    expect(rateLimited).toMatchObject({ error: "SCIVERSE_RATE_LIMITED", retryAfterMs: 2000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes the caller abort signal into fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(relationsPayload));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await sciversePaperRelations({ ...ctx, signal: controller.signal }, { uniqueId: "paper:x", relation: "citations" });
    const usedSignal = (fetchMock.mock.calls[0] as [string, RequestInit])[1].signal as AbortSignal;
    controller.abort();
    expect(usedSignal.aborted).toBe(true);
  });
});

// ─── Catalog-aware advanced filters ─────────────────────────────────────────

const papersCatalog = {
  fields: [
    { name: "language", type: "String", filterable: true, sortable: false, searchable: false, default_returned: false, operators: ["FILTER_OP_EQ", "FILTER_OP_IN"] },
    { name: "type", type: "List[string]", filterable: true, sortable: false, searchable: false, default_returned: false, operators: ["FILTER_OP_IN"] },
    { name: "citation_count", type: "Integer", filterable: true, sortable: true, searchable: false, default_returned: false, operators: ["FILTER_OP_GTE", "FILTER_OP_LTE"] },
    { name: "abstract", type: "String", filterable: false, sortable: false, searchable: true, default_returned: true },
    { name: "title", type: "String", filterable: true, sortable: false, searchable: true, default_returned: true, operators: ["FILTER_OP_CONTAINS"] },
    { name: "author", type: "List[object]", filterable: true, sortable: false, searchable: true, default_returned: true, operators: ["FILTER_OP_IN"] },
    { name: "publication_published_year", type: "Integer", filterable: true, sortable: true, searchable: false, default_returned: true, operators: ["FILTER_OP_GTE", "FILTER_OP_LTE"] },
    { name: "publication_venue_name_unified", type: "String", filterable: true, sortable: false, searchable: true, default_returned: true, operators: ["FILTER_OP_IN"] },
    { name: "subjects", type: "List[string]", filterable: true, sortable: false, searchable: false, default_returned: false, operators: ["FILTER_OP_IN"] },
  ],
  default_fields: ["unique_id", "title"],
  filter_operators: ["FILTER_OP_EQ", "FILTER_OP_IN", "FILTER_OP_GTE"],
};

function catalogAwareFetch(body: unknown = metaSearchPayload) {
  return vi.fn().mockImplementation((url: string) => {
    if (String(url).includes("/meta-catalog")) return Promise.resolve(jsonResponse(papersCatalog));
    return Promise.resolve(jsonResponse(body));
  });
}

function searchBodyOf(fetchMock: ReturnType<typeof vi.fn>, index = -1): Record<string, unknown> {
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/meta-search"));
  const call = index < 0 ? calls[calls.length + index] : calls[index];
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

describe("sciverse.search · catalog-aware filterIntent", () => {
  beforeEach(() => invalidateSciverseCatalogCache());

  it("compiles a high-level intent into validated wire filters and reports provenance", async () => {
    const fetchMock = catalogAwareFetch();
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseSearch(ctx, {
      query: "moe routing",
      filterIntent: { languages: ["en"], publicationTypes: ["review"], citationCountMin: 10 },
    }) as { advancedFilters: Record<string, unknown> };
    const body = searchBodyOf(fetchMock);
    expect(body.filters).toEqual([
      { field: "type", operator: "FILTER_OP_IN", value: ["review"] },
      { field: "language", operator: "FILTER_OP_IN", value: ["en"] },
      { field: "citation_count", operator: "FILTER_OP_GTE", value: 10 },
    ]);
    expect(result.advancedFilters).toMatchObject({
      catalog: "live",
      applied: [
        { key: "publicationTypes", field: "type", operator: "FILTER_OP_IN" },
        { key: "languages", field: "language", operator: "FILTER_OP_IN" },
        { key: "citationCountMin", field: "citation_count", operator: "FILTER_OP_GTE" },
      ],
    });
  });

  it("never lets a model supply a raw field name or operator", async () => {
    const fetchMock = catalogAwareFetch();
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseSearch(ctx, {
      query: "q",
      filterIntent: { field: "secret_field", operator: "FILTER_OP_MATCH", value: "x" },
    });
    expect(result).toMatchObject({ error: "SCIVERSE_INVALID_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops a filter whose field the live catalog does not expose and still searches", async () => {
    const fetchMock = catalogAwareFetch();
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseSearch(ctx, { query: "q", filterIntent: { oaStatus: ["gold"] } }) as { advancedFilters: Record<string, unknown> };
    expect(searchBodyOf(fetchMock).filters).toBeUndefined();
    expect(result.advancedFilters).toMatchObject({ catalog: "live", applied: [], dropped: [{ key: "oaStatus", reason: "unknown_field" }] });
  });

  it("degrades to the plain query when /meta-catalog is unavailable", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/meta-catalog")) return Promise.resolve(jsonResponse({ code: "UPSTREAM", message: "down" }, 502));
      return Promise.resolve(jsonResponse(metaSearchPayload));
    });
    vi.stubGlobal("fetch", fetchMock);
    // 502 is retried once by the transport, so the catalog failure costs two bounded calls.
    const result = await sciverseSearch(ctx, { query: "q", filterIntent: { languages: ["en"] } }) as { papers: unknown[]; advancedFilters: Record<string, unknown> };
    expect(result.papers).toHaveLength(1);
    expect(searchBodyOf(fetchMock).filters).toBeUndefined();
    expect(result.advancedFilters).toMatchObject({ catalog: "unavailable", applied: [], dropped: [{ key: "languages", reason: "catalog_unavailable" }] });
  });

  it("caches the catalog across calls instead of refetching it", async () => {
    const fetchMock = catalogAwareFetch();
    vi.stubGlobal("fetch", fetchMock);
    await sciverseSearch(ctx, { query: "a", filterIntent: { languages: ["en"] } });
    await sciverseSearch(ctx, { query: "b", filterIntent: { languages: ["en"] } });
    const catalogCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/meta-catalog"));
    expect(catalogCalls).toHaveLength(1);
  });

  it("retries once without advanced filters when the filtered query returns nothing", async () => {
    const empty = { results: [], total_count: 0, page: 1, page_size: 10, total_pages: 0 };
    let searchCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/meta-catalog")) return Promise.resolve(jsonResponse(papersCatalog));
      searchCount += 1;
      return Promise.resolve(jsonResponse(searchCount === 1 ? empty : metaSearchPayload));
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseSearch(ctx, { query: "q", filterIntent: { languages: ["en"] } }) as { papers: unknown[]; advancedFilters: Record<string, unknown> };
    expect(searchCount).toBe(2);
    expect(result.papers).toHaveLength(1);
    expect(result.advancedFilters).toMatchObject({ relaxedRetry: true });
    expect(searchBodyOf(fetchMock, -1).filters).toBeUndefined();
  });

  it("does not relax-retry a plain query without advanced filters", async () => {
    const empty = { results: [], total_count: 0, page: 1, page_size: 10, total_pages: 0 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(empty));
    vi.stubGlobal("fetch", fetchMock);
    await sciverseSearch(ctx, { query: "q" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps basic filters working unchanged when no intent is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(metaSearchPayload));
    vi.stubGlobal("fetch", fetchMock);
    await sciverseSearch(ctx, { query: "attention", authors: ["Vaswani"], yearFrom: 2017, abstractContains: "transformer" });
    const body = searchBodyOf(fetchMock);
    expect(body.query).toBe("attention transformer");
    expect(body.filters).toEqual([
      { field: "author", operator: "FILTER_OP_IN", value: ["Vaswani"] },
      { field: "publication_published_year", operator: "FILTER_OP_GTE", value: 2017 },
    ]);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/meta-catalog"))).toBe(true);
  });
});

describe("sciverse.resource handler", () => {
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("fetches bounded image bytes by relative file name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(imageBytes, { status: 200, headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseResource(ctx, { fileName: "dt=2025-08-07/ht=09/abc.jpg", docId: "d".repeat(64) }) as Record<string, unknown>;
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).toContain("/resource?file_name=dt%3D2025-08-07%2Fht%3D09%2Fabc.jpg");
    expect(result).toMatchObject({ mimeType: "image/png", byteLength: imageBytes.length, dataIncluded: true });
    expect(Buffer.from(String(result.dataBase64), "base64").equals(imageBytes)).toBe(true);
  });

  it("rejects absolute paths, traversal, backslashes, URLs and bare names", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const fileName of ["/etc/passwd", "../../secret.png", "a\\b.png", "https://evil.test/x.png", "figure1.png", "a//b.png", ""]) {
      expect(await sciverseResource(ctx, { fileName })).toMatchObject({ error: "SCIVERSE_INVALID_REQUEST" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns metadata only for oversized or non-image resources", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from("not an image"), { status: 200, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sciverseResource(ctx, { fileName: "figures/f1.png" }) as Record<string, unknown>;
    expect(result).toMatchObject({ dataIncluded: false });
    expect(result.dataBase64).toBeUndefined();
  });

  it("maps 404 to a recoverable resource-unavailable state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: "NOT_FOUND", message: "no such file" }, 404));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sciverseResource(ctx, { fileName: "figures/missing.png" })).toMatchObject({
      error: "SCIVERSE_RESOURCE_UNAVAILABLE",
      recoverable: true,
    });
  });

  it("returns SCIVERSE_NOT_CONFIGURED without a token", async () => {
    delete process.env.SCIVERSE_API_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sciverseResource(ctx, { fileName: "figures/f1.png" })).toMatchObject({ error: "SCIVERSE_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the caller abort signal into fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(imageBytes, { status: 200, headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await sciverseResource({ ...ctx, signal: controller.signal }, { fileName: "figures/f1.png" });
    const usedSignal = (fetchMock.mock.calls[0] as [string, RequestInit])[1].signal as AbortSignal;
    controller.abort();
    expect(usedSignal.aborted).toBe(true);
  });
});
