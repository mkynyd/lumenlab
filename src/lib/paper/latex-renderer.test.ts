import { describe, expect, it } from "vitest";
import { buildEmptyAcademicDocument } from "./document-schema";
import { renderAcademicDocumentToLatex } from "./latex-renderer";

describe("academic latex renderer", () => {
  it("renders a document through generated content", () => {
    const result = renderAcademicDocumentToLatex(buildEmptyAcademicDocument("论文"));
    expect(result.mainTex).toContain("generated-content.tex");
    expect(result.generatedContentTex).toContain("\\title");
    expect(result.nodeMap["section-1"]).toBeDefined();
  });
});
