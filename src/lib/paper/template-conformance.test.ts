import { describe, expect, it } from "vitest";
import { buildGeneralAcademicTemplateManifest } from "./template-registry";
import { buildSampleAcademicDocument, runTemplateConformance } from "./template-conformance";

describe("academic template conformance", () => {
  it("covers the stable document surface and detects missing citations", () => {
    const result = runTemplateConformance({
      document: buildSampleAcademicDocument(),
      manifest: buildGeneralAcademicTemplateManifest(),
      references: [{ id: "ref-sample", title: "Sample Reference", authors: ["Author"], year: 2026, venue: "Journal", doi: null, url: null }],
    });
    expect(result.status).toBe("passed");
    expect(result.blockCount).toBeGreaterThanOrEqual(15);
    expect(result.nodeCount).toBeGreaterThanOrEqual(10);
    expect(result.rendered.generatedContentTex).toContain("\\begin{equation}");
  });

  it("marks a sample with an unresolved citation for review", () => {
    const result = runTemplateConformance({ manifest: buildGeneralAcademicTemplateManifest(), references: [] });
    expect(result.status).toBe("needs_review");
    expect(result.issues).toContain("引用目标不存在：ref-sample");
  });
});
