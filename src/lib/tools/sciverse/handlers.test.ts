// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@/lib/agent/tool-executor";
import { sciversePaperRelations, sciverseRead, sciverseSearch, sciverseSemanticSearch } from "./handlers";

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
