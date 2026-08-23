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

  it("adapts a generic class from a pinned source entry", () => {
    const result = renderAcademicDocumentToLatex(buildSampleAcademicDocument(), {
      manifest: { id: "jnu", university: "暨南大学", format: "latex", entryFile: "main.tex", documentClass: "book", supportedBlocks: [] } as AcademicTemplateManifest,
      templateFiles: [{ path: "JNUThesis.tex", buffer: Buffer.from("\\documentclass{book}\n\\usepackage[UTF8,fontset=none]{ctex}\n\\usepackage{algorithm}") }],
    });
    expect(result.mainTex).toContain("\\usepackage[UTF8,fontset=fandol]{ctex}");
    expect(result.mainTex).toContain("\\usepackage{algorithm}");
    expect(result.generatedContentTex).toContain("\\chapter*{摘要}");
  });

  it("uses declared metadata and abstract adapters from a pinned source", () => {
    const result = renderAcademicDocumentToLatex(buildSampleAcademicDocument(), {
      manifest: { id: "cumt", university: "中国矿业大学", format: "latex", documentClass: "book", supportedBlocks: [] } as AcademicTemplateManifest,
      templateFiles: [{ path: "main.tex", buffer: Buffer.from("\\documentclass{book}\n\\newcommand{\\cumtsetup}[1]{}\n\\newenvironment{abstract}{}{}\n\\newcommand{\\keywords}[1]{}") }],
    });
    expect(result.mainTex).toContain("\\cumtsetup{");
    expect(result.generatedContentTex).toContain("\\begin{abstract}");
    expect(result.generatedContentTex).toContain("\\keywords{");
  });

  it("keeps key-value metadata braces balanced for DTX-backed classes", () => {
    const result = renderAcademicDocumentToLatex(buildEmptyAcademicDocument("论文"), {
      manifest: { id: "nuaa", university: "南京航空航天大学", format: "latex", documentClass: "nuaathesis", degreeType: "硕士", supportedBlocks: [] } as AcademicTemplateManifest,
      templateFiles: [{ path: "nuaathesis.dtx", buffer: Buffer.from("\\def\\nuaaset#1{}") }],
    });
    expect(result.mainTex).toContain("\\nuaaset{title = {");
    expect(result.mainTex).not.toContain("degree = {master}");
  });
});
