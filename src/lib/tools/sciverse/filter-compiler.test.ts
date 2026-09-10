// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  catalogTypeFamily,
  compileSciverseFilterIntent,
  describeCompiledSciverseFilters,
  parseSciverseFilterIntent,
  SCIVERSE_MAX_ADVANCED_FILTERS,
  validateBasicSciverseFilters,
  type SciverseFilterIntent,
} from "./filter-compiler";
import type { SciverseCatalog, SciverseCatalogField } from "./types";

/**
 * Field shape mirrors the live `/meta-catalog?collection=papers` response that
 * was verified against production on 2026-09-11.
 */
function field(name: string, type: string, extra: Partial<SciverseCatalogField> = {}): SciverseCatalogField {
  return {
    name,
    type,
    filterable: true,
    sortable: false,
    searchable: false,
    default_returned: false,
    ...extra,
  };
}

const CATALOG: SciverseCatalog = {
  fields: [
    field("access_is_oa", "String", { operators: ["FILTER_OP_EQ", "FILTER_OP_IN"] }),
    field("access_oa_status", "String", { operators: ["FILTER_OP_EQ", "FILTER_OP_IN"] }),
    field("publication_venue_type", "String", { operators: ["FILTER_OP_EQ", "FILTER_OP_IN"] }),
    field("metadata_type", "String", { operators: ["FILTER_OP_EQ", "FILTER_OP_IN"] }),
    field("language", "String", { operators: ["FILTER_OP_EQ", "FILTER_OP_IN"] }),
    field("type", "List[string]", { operators: ["FILTER_OP_IN", "FILTER_OP_NIN"] }),
    field("publication_publisher", "List[string]", { operators: ["FILTER_OP_IN"] }),
    field("keywords", "List[string]", { operators: ["FILTER_OP_IN", "FILTER_OP_MATCH"] }),
    field("doi", "String", { operators: ["FILTER_OP_EQ", "FILTER_OP_IN"] }),
    field("references_unique_id", "List[string]", { operators: ["FILTER_OP_IN", "FILTER_OP_CONTAINS"] }),
    field("citation_count", "Integer", { sortable: true, operators: ["FILTER_OP_GTE", "FILTER_OP_LTE"] }),
    field("influential_citation_count", "Integer", { sortable: true, operators: ["FILTER_OP_GTE", "FILTER_OP_LTE"] }),
    field("fwci", "Float", { sortable: true, operators: ["FILTER_OP_GTE", "FILTER_OP_LTE"] }),
    field("reference_count", "Integer", { sortable: true, operators: ["FILTER_OP_GTE", "FILTER_OP_LTE"] }),
    field("publication_published_date", "Date", { sortable: true, operators: ["FILTER_OP_GTE", "FILTER_OP_LTE"] }),
    field("publication_published_year", "Integer", { sortable: true, operators: ["FILTER_OP_GTE", "FILTER_OP_LTE"] }),
    field("title", "String", { operators: ["FILTER_OP_CONTAINS"] }),
    field("abstract", "String", { filterable: false }),
    field("citation_normalized_percentile.is_in_top_10_percent", "Boolean", { operators: ["FILTER_OP_EQ"] }),
    field("citation_normalized_percentile.is_in_top_1_percent", "Boolean", { operators: ["FILTER_OP_EQ"] }),
  ],
  default_fields: ["unique_id", "title"],
  filter_operators: ["FILTER_OP_EQ", "FILTER_OP_IN", "FILTER_OP_GTE"],
};

function compile(intent: SciverseFilterIntent, catalog: SciverseCatalog | null = CATALOG) {
  return compileSciverseFilterIntent(intent, catalog, catalog ? "live" : "unavailable");
}

describe("sciverse filter compiler · intent shape", () => {
  it("accepts an empty or omitted intent without touching the catalog", () => {
    expect(parseSciverseFilterIntent(undefined)).toEqual({ ok: true, intent: {} });
    expect(compile({})).toMatchObject({ filters: [], applied: [], dropped: [] });
  });

  it("rejects unknown intent keys so a model cannot probe the upstream schema", () => {
    const result = parseSciverseFilterIntent({ field: "doi", operator: "FILTER_OP_EQ" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("未知字段");
  });

  it("rejects wrong value types and out-of-range enums", () => {
    expect(parseSciverseFilterIntent({ languages: "en" }).ok).toBe(false);
    expect(parseSciverseFilterIntent({ openAccess: "true" }).ok).toBe(false);
    expect(parseSciverseFilterIntent({ topPercentile: "top_50_percent" }).ok).toBe(false);
    expect(parseSciverseFilterIntent({ citationCountMin: Number.NaN }).ok).toBe(false);
    expect(parseSciverseFilterIntent({ doi: 42 }).ok).toBe(false);
  });
});

describe("sciverse filter compiler · catalog validation", () => {
  it("compiles a valid intent into server-chosen field/operator pairs", () => {
    const compiled = compile({
      publicationTypes: ["review", "preprint"],
      languages: ["en", "zh"],
      topPercentile: "top_10_percent",
      citationCountMin: 25,
      oaStatus: ["gold", "hybrid"],
    });
    expect(compiled.filters).toEqual([
      { field: "access_oa_status", operator: "FILTER_OP_IN", value: ["gold", "hybrid"] },
      { field: "type", operator: "FILTER_OP_IN", value: ["review", "preprint"] },
      { field: "language", operator: "FILTER_OP_IN", value: ["en", "zh"] },
      { field: "citation_normalized_percentile.is_in_top_10_percent", operator: "FILTER_OP_EQ", value: true },
      { field: "citation_count", operator: "FILTER_OP_GTE", value: 25 },
    ]);
    expect(compiled.applied.map((entry) => entry.key)).toEqual([
      "oaStatus",
      "publicationTypes",
      "languages",
      "topPercentile",
      "citationCountMin",
    ]);
    expect(compiled.dropped).toEqual([]);
    expect(compiled.catalog).toBe("live");
  });

  it("drops intents whose catalog field does not exist", () => {
    const compiled = compile({ keywords: ["routing"] }, { ...CATALOG, fields: CATALOG.fields.filter((entry) => entry.name !== "keywords") });
    expect(compiled.filters).toEqual([]);
    expect(compiled.dropped).toEqual([{ key: "keywords", reason: "unknown_field" }]);
  });

  it("drops intents whose catalog field is not filterable", () => {
    const compiled = compile({ publishers: ["ACM"] }, {
      ...CATALOG,
      fields: CATALOG.fields.map((entry) => entry.name === "publication_publisher" ? { ...entry, filterable: false } : entry),
    });
    expect(compiled.filters).toEqual([]);
    expect(compiled.dropped).toEqual([{ key: "publishers", reason: "not_filterable" }]);
  });

  it("drops intents whose operator is not supported by the field", () => {
    const compiled = compile({ keywords: ["routing"] }, {
      ...CATALOG,
      fields: CATALOG.fields.map((entry) => entry.name === "keywords" ? { ...entry, operators: ["FILTER_OP_IN"] } : entry),
    });
    expect(compiled.filters).toEqual([]);
    expect(compiled.dropped).toEqual([{ key: "keywords", reason: "unsupported_operator" }]);
  });

  it("drops intents whose value type does not match the catalog type", () => {
    const compiled = compile({ citationCountMin: 10 }, {
      ...CATALOG,
      fields: CATALOG.fields.map((entry) => entry.name === "citation_count" ? { ...entry, type: "String" } : entry),
    });
    expect(compiled.filters).toEqual([]);
    expect(compiled.dropped).toEqual([{ key: "citationCountMin", reason: "type_mismatch" }]);
  });

  it("clamps the number of advanced filters strictly", () => {
    const compiled = compile({
      openAccess: true,
      oaStatus: ["gold"],
      venueTypes: ["journal"],
      publicationTypes: ["article"],
      resourceTypes: ["paper"],
      languages: ["en"],
      publishers: ["ACM"],
      citationCountMin: 1,
    });
    expect(compiled.filters).toHaveLength(SCIVERSE_MAX_ADVANCED_FILTERS);
    expect(compiled.dropped.every((entry) => entry.reason === "filter_budget_exceeded")).toBe(true);
    expect(compiled.dropped.length).toBeGreaterThan(0);
  });

  it("clamps array length, string length and numeric bounds", () => {
    const compiled = compile({
      languages: ["en", "zh", "de", "fr", "ja", "ko", "ru", "it", "pt", "nl"],
      publishers: ["A".repeat(400)],
      citationCountMin: -5,
    });
    expect(compiled.filters[0]).toEqual({ field: "language", operator: "FILTER_OP_IN", value: ["en", "zh", "de", "fr", "ja", "ko"] });
    expect(compiled.dropped).toEqual([
      { key: "publishers", reason: "invalid_value" },
      { key: "citationCountMin", reason: "invalid_value" },
    ]);
  });

  it("rejects categorical values outside the published sample-value sets", () => {
    const compiled = compile({ oaStatus: ["free-for-all"], venueTypes: ["blog"] });
    expect(compiled.filters).toEqual([]);
    expect(compiled.dropped).toEqual([
      { key: "oaStatus", reason: "invalid_value" },
      { key: "venueTypes", reason: "invalid_value" },
    ]);
  });

  it("normalizes DOI values and rejects non-DOI strings", () => {
    expect(compile({ doi: "https://doi.org/10.1109/CVPR.2016.90" }).filters[0]).toEqual({
      field: "doi",
      operator: "FILTER_OP_EQ",
      value: "10.1109/CVPR.2016.90",
    });
    expect(compile({ doi: "not-a-doi" }).dropped).toEqual([{ key: "doi", reason: "invalid_value" }]);
  });

  it("validates the reverse-citation unique id shape", () => {
    // references_unique_id 只支持 IN/NIN/CONTAINS，因此模型的高层 intent 编译成
    // 单元素 IN，而不是上游会 400 的 EQ。
    expect(compile({ citedBy: "paper:10.1109/cvpr.2016.90" }).filters[0]).toEqual({
      field: "references_unique_id",
      operator: "FILTER_OP_IN",
      value: ["paper:10.1109/cvpr.2016.90"],
    });
    expect(compile({ citedBy: "../../etc/passwd" }).dropped).toEqual([{ key: "citedBy", reason: "invalid_value" }]);
  });
});

describe("sciverse filter compiler · catalog outage degradation", () => {
  it("emits nothing when the catalog is unavailable", () => {
    const compiled = compileSciverseFilterIntent(
      { languages: ["en"], citationCountMin: 10 },
      null,
      "unavailable",
    );
    expect(compiled.filters).toEqual([]);
    expect(compiled.catalog).toBe("unavailable");
    expect(compiled.dropped).toEqual([
      { key: "languages", reason: "catalog_unavailable" },
      { key: "citationCountMin", reason: "catalog_unavailable" },
    ]);
  });

  it("never forwards an unvalidated field even when the intent is well formed", () => {
    const compiled = compileSciverseFilterIntent({ keywords: ["x"] }, null, "unavailable");
    expect(compiled.filters).toEqual([]);
  });
});

describe("sciverse filter compiler · basic filter validation", () => {
  it("drops typed basic filters whose field is not filterable (abstract)", () => {
    const result = validateBasicSciverseFilters(
      [
        { field: "title", operator: "FILTER_OP_CONTAINS", value: "x" },
        { field: "abstract", operator: "FILTER_OP_CONTAINS", value: "y" },
      ],
      CATALOG,
    );
    expect(result.filters).toEqual([{ field: "title", operator: "FILTER_OP_CONTAINS", value: "x" }]);
    expect(result.dropped).toEqual(["abstract"]);
  });

  it("passes typed basic filters through unchanged when the catalog is unavailable", () => {
    const filters = [{ field: "title", operator: "FILTER_OP_CONTAINS" as const, value: "x" }];
    expect(validateBasicSciverseFilters(filters, null)).toEqual({ filters, dropped: [] });
  });
});

describe("sciverse filter compiler · provenance and type families", () => {
  it("describes only bounded, server-generated provenance", () => {
    const compiled = compile({ languages: ["en"], citedBy: "bad id!" });
    const described = describeCompiledSciverseFilters(compiled);
    expect(described).toEqual({
      catalog: "live",
      applied: [{ key: "languages", field: "language", operator: "FILTER_OP_IN" }],
      dropped: [{ key: "citedBy", reason: "invalid_value" }],
    });
    expect(JSON.stringify(described)).not.toContain("en\"");
  });

  it("returns an empty provenance block when nothing was requested", () => {
    expect(describeCompiledSciverseFilters(compile({}))).toEqual({});
  });

  it("maps catalog type strings onto bounded families", () => {
    expect(catalogTypeFamily("String")).toBe("string");
    expect(catalogTypeFamily("Integer")).toBe("number");
    expect(catalogTypeFamily("Float")).toBe("number");
    expect(catalogTypeFamily("Boolean")).toBe("boolean");
    expect(catalogTypeFamily("Date")).toBe("date");
    expect(catalogTypeFamily("List[string]")).toBe("array");
    expect(catalogTypeFamily("Weird")).toBeNull();
  });
});
