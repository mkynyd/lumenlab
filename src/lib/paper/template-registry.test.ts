import { describe, expect, it } from "vitest";
import { buildGeneralAcademicTemplateManifest, buildTemplateManifest, mapTemplateRuntimeStatus, normalizeTemplateManifest, parseTemplateRegistry } from "./template-registry";

describe("template registry", () => {
  it("keeps recommendation and runtime status separate", () => {
    const [record] = parseTemplateRegistry([{ id: "x", university: "A", format: "latex", status: "stale", recommendationLevel: "A" }]);
    expect(record.recommendationLevel).toBe("A");
    expect(mapTemplateRuntimeStatus(record)).toBe("Needs Review");
  });

  it("provides a validated general academic adapter manifest", () => {
    const manifest = normalizeTemplateManifest(buildGeneralAcademicTemplateManifest());
    expect(manifest.documentClass).toBe("ctexart");
    expect(manifest.supportedBlocks).toContain("bibliography");
    expect(manifest.upstreamSnapshot?.materialized).toBe(true);
  });

  it("builds a pinned registry manifest without inventing a local upstream checkout", () => {
    const manifest = buildTemplateManifest({ id: "bit", university: "北京理工大学", format: "latex", repositoryUrl: "https://github.com/BITNP/BIThesis", version: "v3.x", lastCommit: "2026-07-02", sourceType: "校内组织", bibliography: "bibtex", recommendationLevel: "A" });
    expect(manifest.upstreamSnapshot).toMatchObject({ commitOrVersion: "v3.x", materialized: false, repositoryUrl: "https://github.com/BITNP/BIThesis" });
    expect(manifest.sample).toEqual({ fixtureId: "sample-academic-v1", status: "pending" });
  });

  it("does not turn human-readable class metadata into executable LaTeX", () => {
    const manifest = buildTemplateManifest({ id: "pkuthss", university: "北京大学", format: "latex", documentClass: "pkuthss v1.9.4" });
    expect(manifest.documentClass).toBeNull();
  });
});
