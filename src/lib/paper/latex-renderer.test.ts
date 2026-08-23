import { describe, expect, it } from "vitest";
import { buildEmptyAcademicDocument } from "./document-schema";
import { buildSampleAcademicDocument } from "./template-conformance";
import type { AcademicTemplateManifest } from "./template-registry";
import { renderAcademicDocumentToLatex } from "./latex-renderer";

describe("academic latex renderer", () => {
  it("renders a document through generated content", () => {
    const result = renderAcademicDocumentToLatex(buildEmptyAcademicDocument("论文"));
    expect(result.mainTex).toContain("generated-content.tex");
    expect(result.generatedContentTex).toContain("\\title");
    expect(result.generatedContentTex).toContain("\\maketitle");
    expect(result.nodeMap["section-1"]).toBeDefined();
  });

  it("uses template-specific metadata and bibliography adapters", () => {
    const result = renderAcademicDocumentToLatex(buildSampleAcademicDocument(), {
      manifest: { id: "thuthesis-test", university: "清华大学", format: "latex", supportedBlocks: [], degreeType: "硕士", documentClass: "thuthesis", bibliography: "biblatex-gb7714-2015" } as AcademicTemplateManifest,
    });
    expect(result.mainTex).toContain("\\documentclass[master]{thuthesis}");
    expect(result.mainTex).toContain("\\usepackage[backend=biber,style=thuthesis-numeric]{biblatex}");
    expect(result.mainTex).toContain("\\thusetup{");
    expect(result.generatedContentTex).toContain("\\maketitle");
    expect(result.generatedContentTex).toContain("\\printbibliography");
  });
});
