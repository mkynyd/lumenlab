import { describe, expect, it, vi } from "vitest";
import { createAcademicSourceAdapters } from "./academic-adapters";
import type { ResearchProviderContext } from "./source-provider";

const context: ResearchProviderContext = {
  userId: "user-1",
  conversationId: "conversation-1",
  executionId: "execution-1",
  runId: "run-1",
  signal: new AbortController().signal,
};

describe("academic source adapters", () => {
  it("normalizes DOI candidates and reads an immutable source payload", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("api.openalex.org/works?")) {
        return new Response(JSON.stringify({ results: [{ id: "https://openalex.org/W1", doi: "https://doi.org/10.1234/ABC", title: "A paper", publication_year: 2024 }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "W1", title: "A paper", publication_year: 2024, abstract_inverted_index: { Evidence: [0], matters: [1] } }), { status: 200 });
    });
    const adapter = createAcademicSourceAdapters({ fetcher }).find((item) => item.provider === "openalex");
    expect(adapter).toBeDefined();
    const candidates = await adapter!.search(context, "evidence");
    expect(candidates[0]).toMatchObject({ externalId: "10.1234/abc", title: "A paper", kind: "academic_paper" });
    const read = await adapter!.read(context, candidates[0]);
    expect(read).toMatchObject({ sourceVersion: "2024", locator: { kind: "openalex" } });
    expect(read?.excerpt).toBe("Evidence matters");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps provider failure isolated from the caller", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 503 }));
    const adapter = createAcademicSourceAdapters({ fetcher }).find((item) => item.provider === "pubmed");
    await expect(adapter!.search(context, "query")).resolves.toEqual([]);
  });
});
