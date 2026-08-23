import { describe, expect, it } from "vitest";
import { buildSourceIdentity, normalizeCanonicalUrl, normalizeDoi } from "./source-identity";

describe("research source identity", () => {
  it("deduplicates DOI forms", () => {
    expect(normalizeDoi("https://doi.org/10.1000/ABC.")).toBe("10.1000/abc");
    expect(buildSourceIdentity({ kind: "academic_paper", doi: "doi:10.1000/ABC" }).canonicalKey).toBe("doi:10.1000/abc");
  });

  it("removes tracking parameters from canonical URLs", () => {
    expect(normalizeCanonicalUrl("https://example.com/paper?utm_source=x&id=2#intro")).toBe("https://example.com/paper?id=2");
  });

  it("uses a stable project-file identity", () => {
    expect(buildSourceIdentity({ kind: "project_file", fileId: "file-1" }).canonicalKey).toBe("project_file:file:file-1");
  });

  it("keeps unknown identities deterministic for retry deduplication", () => {
    const input = { kind: "web" as const, url: null };
    expect(buildSourceIdentity(input).canonicalKey).toBe(buildSourceIdentity(input).canonicalKey);
  });
});
