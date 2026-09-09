// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildAgenticFilters,
  buildAgenticSearchRequest,
  buildMetaSearchRequest,
  clampReadLimit,
  clampReadOffset,
  clampSearchPage,
  clampSearchPageSize,
  clampSemanticTopK,
  parseAgenticSearchResponse,
  parseContentResponse,
  parseMetaSearchResponse,
  SCIVERSE_SEARCH_FIELDS,
} from "./normalize";

describe("meta-search wire mapping", () => {
  it("maps convenience fields to FieldFilterItem entries", () => {
    const body = buildMetaSearchRequest({
      query: "agent",
      titleContains: "Transformer",
      abstractContains: "attention",
      authors: ["Hinton", "LeCun"],
      journals: ["Nature"],
      subjects: ["computer science"],
      yearFrom: 2020,
      yearTo: 2025,
      page: 2,
      pageSize: 15,
    });
    expect(body.collection).toBe("papers");
    expect(body.query).toBe("agent");
    expect(body.page).toBe(2);
    expect(body.page_size).toBe(15);
    expect(body.fields).toEqual([...SCIVERSE_SEARCH_FIELDS]);
    expect(body.filters).toEqual([
      { field: "title", operator: "FILTER_OP_CONTAINS", value: "Transformer" },
      { field: "abstract", operator: "FILTER_OP_CONTAINS", value: "attention" },
      { field: "author", operator: "FILTER_OP_IN", value: ["Hinton", "LeCun"] },
      { field: "publication_published_year", operator: "FILTER_OP_GTE", value: 2020 },
      { field: "publication_published_year", operator: "FILTER_OP_LTE", value: 2025 },
      { field: "publication_venue_name_unified", operator: "FILTER_OP_IN", value: ["Nature"] },
      { field: "subjects", operator: "FILTER_OP_IN", value: ["computer science"] },
    ]);
  });

  it("passes boosts through as snake_case enums and omits NONE", () => {
    const body = buildMetaSearchRequest({
      query: "q",
      freshnessBoost: "MILD",
      impactBoost: "STRONG",
      languageAffinity: "NONE",
    });
    expect(body.freshness_boost).toBe("MILD");
    expect(body.impact_boost).toBe("STRONG");
    expect(body.language_affinity).toBeUndefined();
  });

  it("never sends sort when a query is present, even with explicit desc", () => {
    expect(buildMetaSearchRequest({ query: "q", sortByYear: "desc" }).sort).toBeUndefined();
    expect(buildMetaSearchRequest({ query: "q", sortByYear: "asc" }).sort).toBeUndefined();
    expect(buildMetaSearchRequest({ query: "q" }).sort).toBeUndefined();
  });

  it("sends a year sort only for query-less scans (explicit and auto)", () => {
    expect(buildMetaSearchRequest({ sortByYear: "desc" }).sort).toEqual([
      { field: "publication_published_year", order: "SORT_ORDER_DESC" },
    ]);
    expect(buildMetaSearchRequest({ sortByYear: "asc" }).sort).toEqual([
      { field: "publication_published_year", order: "SORT_ORDER_ASC" },
    ]);
    expect(buildMetaSearchRequest({}).sort).toEqual([
      { field: "publication_published_year", order: "SORT_ORDER_DESC" },
    ]);
    expect(buildMetaSearchRequest({ sortByYear: "none" }).sort).toBeUndefined();
  });

  it("omits empty optional fields and clamps page/pageSize", () => {
    const body = buildMetaSearchRequest({ query: "  ", page: 0, pageSize: 999 });
    expect(body.query).toBeUndefined();
    expect(body.filters).toBeUndefined();
    expect(body.page).toBe(1);
    expect(body.page_size).toBe(25);
    expect(clampSearchPage(undefined)).toBe(1);
    expect(clampSearchPageSize(undefined)).toBe(10);
    expect(clampSearchPageSize(0)).toBe(1);
    expect(clampSearchPageSize(Number.NaN)).toBe(10);
  });
});

describe("meta-search response parsing", () => {
  it("keeps uniqueId and docId strictly separate and preserves isContentAccessible", () => {
    const result = parseMetaSearchResponse({
      results: [
        {
          unique_id: "paper:10.1/abc",
          doc_id: "sha256hex",
          title: "Paper A",
          author: [{ name: "Ada Lovelace", orcid: "0000-0001" }, "Plain String Author"],
          abstract: "  some   abstract ".repeat(100),
          doi: "10.1000/xyz",
          publication_venue_name_unified: "Nature",
          publication_published_year: 2023,
          citation_count: 42,
          influential_citation_count: 7,
          fwci: 1.5,
          access_is_oa: true,
          access_oa_url: "https://oa.example.com/paper.pdf",
          is_content_accessible: true,
        },
        {
          unique_id: "paper:10.1/def",
          title: "Metadata only",
          doi: "10.1000/xyz2",
        },
      ],
      total_count: "12345",
      page: 1,
      page_size: 10,
      total_pages: 3,
    }, 10);

    expect(result.papers).toHaveLength(2);
    const [full, metadataOnly] = result.papers;
    expect(full.uniqueId).toBe("paper:10.1/abc");
    expect(full.docId).toBe("sha256hex");
    expect(full.isContentAccessible).toBe(true);
    expect(full.authors).toEqual(["Ada Lovelace", "Plain String Author"]);
    expect(full.abstractPreview).toHaveLength(400);
    expect(full.url).toBe("https://oa.example.com/paper.pdf");
    expect(full.citationCount).toBe(42);
    expect(full.influentialCitationCount).toBe(7);
    expect(full.fwci).toBe(1.5);
    expect(full.isOpenAccess).toBe(true);

    // No full text: docId absent, isContentAccessible defaults to false, and
    // the URL comes from the DOI resolver instead of any invented location.
    expect(metadataOnly.docId).toBeUndefined();
    expect(metadataOnly.isContentAccessible).toBe(false);
    expect(metadataOnly.url).toBe("https://doi.org/10.1000/xyz2");

    expect(result.totalCount).toBe(12345);
    expect(result.hasMore).toBe(true);
  });

  it("produces no url when neither access_oa_url nor doi exist", () => {
    const result = parseMetaSearchResponse({
      results: [{ unique_id: "u1", title: "T" }],
      total_count: 1,
      page: 1,
      page_size: 10,
    }, 10);
    expect(result.papers[0].url).toBeUndefined();
    expect(result.hasMore).toBe(false);
  });

  it("drops records without uniqueId or title and tolerates missing optional fields", () => {
    const result = parseMetaSearchResponse({
      results: [
        { unique_id: "u1", title: "Keep" },
        { title: "no unique id" },
        { unique_id: "u2" },
        null,
      ],
      total_count: 1,
    } as unknown as Parameters<typeof parseMetaSearchResponse>[0], 10);
    expect(result.papers).toHaveLength(1);
    expect(result.papers[0]).toMatchObject({ uniqueId: "u1", title: "Keep", authors: [] });
  });
});

describe("agentic-search wire mapping", () => {
  it("translates modes to retrieval/sub_queries and never emits mode", () => {
    const fast = buildAgenticSearchRequest({ query: "q", mode: "fast" });
    expect(fast).toMatchObject({ query: "q", top_k: 10, retrieval: "es" });
    expect(fast.sub_queries).toBeUndefined();
    expect(fast.mode).toBeUndefined();

    const balanced = buildAgenticSearchRequest({ query: "q", mode: "balanced" });
    expect(balanced.retrieval).toBe("hybrid");
    expect(balanced.sub_queries).toBeUndefined();

    const quality = buildAgenticSearchRequest({ query: "q", mode: "quality" });
    expect(quality).toMatchObject({ retrieval: "hybrid", sub_queries: 3 });
    expect(quality.mode).toBeUndefined();

    expect(buildAgenticSearchRequest({ query: "q" }).retrieval).toBe("hybrid");
  });

  it("clamps topK and filters sourceTypes to the wire enum", () => {
    const body = buildAgenticSearchRequest({ query: "q", topK: 500, sourceTypes: ["web", "arxiv", "pdf"] });
    expect(body.top_k).toBe(100);
    expect(body.source_types).toEqual(["web", "pdf"]);
    expect(clampSemanticTopK(0)).toBe(1);
    expect(clampSemanticTopK(undefined)).toBe(10);
    expect(clampSemanticTopK("junk")).toBe(10);
  });

  it("builds soft filters and the doc_id hard scope", () => {
    const body = buildAgenticSearchRequest({
      query: "q",
      filters: {
        lang: "en",
        author: ["Hinton", "Bengio"],
        venue: "Nature",
        venueType: "journal",
        yearFrom: 2020,
        yearTo: 2025,
        dateFrom: "2020-01",
        dateTo: "2025-12-31",
        citationCountMin: 10,
        influentialCitationCountMax: 500,
        topicDomain: "Health Sciences",
        primaryTopic: "oncology",
        docIds: ["a".repeat(64), "b".repeat(64)],
      },
    });
    expect(body.filters).toEqual({
      lang: "en",
      author: ["Hinton", "Bengio"],
      publication_venue_name_unified: "Nature",
      publication_venue_type: "journal",
      publication_published_year: { gte: 2020, lte: 2025 },
      publication_published_date: { gte: "2020-01", lte: "2025-12-31" },
      citation_count: { gte: 10 },
      influential_citation_count: { lte: 500 },
      topics: { dimensions: { primary_topic: "oncology", primary_topic_domain: "Health Sciences" } },
      doc_id: ["a".repeat(64), "b".repeat(64)],
    });
  });

  it("omits an entirely empty filters object", () => {
    expect(buildAgenticSearchRequest({ query: "q", filters: {} }).filters).toBeUndefined();
    expect(buildAgenticFilters({ topicDomain: "Not A Domain" })).toEqual({
      topics: { dimensions: {} },
    });
  });
});

describe("agentic-search response parsing", () => {
  it("tolerates missing optional metadata and drops hits without chunkId/docId", () => {
    const result = parseAgenticSearchResponse({
      hits: [
        { chunk_id: "c1", doc_id: "d1", title: "T", score: 0.9, offset: 120 },
        { chunk_id: "c2", doc_id: "d2", title: "Full", score: 0.8, offset: 0, chunk: "evidence", page_no: 3, source_type: "pdf", author: ["Ada"], publication_published_year: 2021, publication_venue_name_unified: "NeurIPS" },
        { chunk_id: "c3", title: "no doc id", score: 0.7, offset: 0 },
        { doc_id: "d4", title: "no chunk id", score: 0.6, offset: 0 },
        null,
      ],
    } as unknown as Parameters<typeof parseAgenticSearchResponse>[0], "q");
    expect(result.count).toBe(2);
    expect(result.hits[0]).toEqual({ chunkId: "c1", docId: "d1", title: "T", score: 0.9, offset: 120 });
    expect(result.hits[1]).toMatchObject({
      chunkId: "c2",
      docId: "d2",
      chunk: "evidence",
      pageNo: 3,
      sourceType: "pdf",
      authors: ["Ada"],
      year: 2021,
      venue: "NeurIPS",
    });
    expect(result.query).toBe("q");
  });
});

describe("content read parsing", () => {
  it("clamps offset and limit to the LumenLab bounds", () => {
    expect(clampReadOffset(-5)).toBe(0);
    expect(clampReadOffset(undefined)).toBe(0);
    expect(clampReadLimit(undefined)).toBe(1200);
    expect(clampReadLimit(0)).toBe(1);
    expect(clampReadLimit(999_999)).toBe(4000);
  });

  it("parses next_offset/more and accepts chars_returned or bytes_returned", () => {
    const withChars = parseContentResponse(
      { text: "hello", chars_returned: 5, text_length: 1000, next_offset: 5, more: true },
      { docId: "d", offset: 0 }
    );
    expect(withChars).toEqual({ docId: "d", offset: 0, text: "hello", returnedChars: 5, totalLength: 1000, nextOffset: 5, more: true });

    const withBytes = parseContentResponse(
      { text: "hi", bytes_returned: 2 },
      { docId: "d", offset: 40 }
    );
    expect(withBytes).toEqual({ docId: "d", offset: 40, text: "hi", returnedChars: 2, more: false });
  });
});
