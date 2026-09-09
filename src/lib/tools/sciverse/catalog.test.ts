// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { listCatalog } from "./catalog";

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
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ fields: [], default_fields: [], filter_operators: [] }));
    await listCatalog({ token: "k", collection: "authors", includeSampleValues: true, fetchImpl });
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("https://api.sciverse.space/meta-catalog?collection=authors&include_sample_values=true");
  });
});
