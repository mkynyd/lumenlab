// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCachedCatalog,
  invalidateSciverseCatalogCache,
  listCatalog,
  SCIVERSE_CATALOG_MAX_ENTRIES,
  SCIVERSE_CATALOG_TTL_MS,
} from "./catalog";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("sciverse catalog (internal capability)", () => {
  it("queries /meta-catalog with the collection and parses fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      fields: [
        {
          name: "title",
          type: "String",
          filterable: true,
          sortable: false,
          searchable: true,
          default_returned: true,
          description: "标题",
          operators: ["CONTAINS"],
        },
        { name: "citation_count", type: "Integer", filterable: true, sortable: true, searchable: false, default_returned: false },
        { bogus: true },
      ],
      default_fields: ["unique_id", "title"],
      filter_operators: ["EQ", "IN", "CONTAINS"],
    }));

    const catalog = await listCatalog({ token: "k", collection: "papers", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sciverse.space/meta-catalog?collection=papers");
    expect(init.method).toBe("GET");
    expect(catalog.fields).toHaveLength(2);
    expect(catalog.fields[0]).toMatchObject({ name: "title", filterable: true, searchable: true, description: "标题" });
    expect(catalog.fields[1]).toMatchObject({ name: "citation_count", sortable: true });
    expect(catalog.default_fields).toEqual(["unique_id", "title"]);
    expect(catalog.filter_operators).toEqual(["EQ", "IN", "CONTAINS"]);
  });

  it("passes include flags only when requested", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ fields: [], default_fields: [], filter_operators: [] }));
    await listCatalog({ token: "k", collection: "authors", includeSampleValues: true, fetchImpl });
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("https://api.sciverse.space/meta-catalog?collection=authors&include_sample_values=true");
  });
});

describe("sciverse catalog cache", () => {
  beforeEach(() => invalidateSciverseCatalogCache());

  it("serves the second lookup from cache within the TTL", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ fields: [], default_fields: [], filter_operators: [] }));
    const first = await getCachedCatalog({ token: "k", fetchImpl, now: 1_000 });
    const second = await getCachedCatalog({ token: "k", fetchImpl, now: 2_000 });
    expect(first.source).toBe("live");
    expect(second.source).toBe("cache");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes after the TTL expires", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ fields: [], default_fields: [], filter_operators: [] }));
    await getCachedCatalog({ token: "k", fetchImpl, now: 1_000 });
    const refreshed = await getCachedCatalog({ token: "k", fetchImpl, now: 1_000 + SCIVERSE_CATALOG_TTL_MS + 1 });
    expect(refreshed.source).toBe("live");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("negatively caches a catalog outage without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "UPSTREAM", message: "boom" }, 500));
    const first = await getCachedCatalog({ token: "k", fetchImpl, now: 1_000 });
    const second = await getCachedCatalog({ token: "k", fetchImpl, now: 1_500 });
    expect(first).toEqual({ catalog: null, source: "unavailable" });
    expect(second.source).toBe("unavailable");
    // 500 is retried once by the transport, so the first outage costs two calls
    // and the negative cache prevents a third.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps the cache bounded and evicts the oldest entry", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ fields: [], default_fields: [], filter_operators: [] }));
    for (let index = 0; index <= SCIVERSE_CATALOG_MAX_ENTRIES; index += 1) {
      await getCachedCatalog({ token: "k", baseUrl: `https://api-${index}.test`, fetchImpl, now: 1_000 });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(SCIVERSE_CATALOG_MAX_ENTRIES + 1);
    // The very first entry was evicted, so it is fetched again.
    await getCachedCatalog({ token: "k", baseUrl: "https://api-0.test", fetchImpl, now: 1_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(SCIVERSE_CATALOG_MAX_ENTRIES + 2);
  });
});
