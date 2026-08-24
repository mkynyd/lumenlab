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

  it("keeps the standard abstract environment for article-like classes", () => {
    const result = renderAcademicDocumentToLatex(buildSampleAcademicDocument(), {
      manifest: { id: "gxu", university: "广西大学", format: "latex", documentClass: "ctexart", supportedBlocks: [] } as AcademicTemplateManifest,
      templateFiles: [{ path: "thesis.tex", buffer: Buffer.from("\\documentclass{ctexart}") }],
    });
    expect(result.generatedContentTex).toContain("\\begin{abstract}");
    expect(result.generatedContentTex).not.toContain("\\chapter*{摘要}");
  });

  it("keeps key-value metadata braces balanced for DTX-backed classes", () => {
    const result = renderAcademicDocumentToLatex(buildEmptyAcademicDocument("论文"), {
      manifest: { id: "nuaa", university: "南京航空航天大学", format: "latex", documentClass: "nuaathesis", degreeType: "硕士", supportedBlocks: [] } as AcademicTemplateManifest,
      templateFiles: [{ path: "nuaathesis.cls", buffer: Buffer.from("\\def\\nuaaset#1{}") }],
    });
    expect(result.mainTex).toContain("\\nuaaset{title = {");
    expect(result.mainTex).not.toContain("degree = {master}");
  });

  it("recognizes biblatex declared by the pinned top-level entry source", () => {
    const result = renderAcademicDocumentToLatex(buildSampleAcademicDocument(), {
      manifest: { id: "wut", university: "武汉理工大学", format: "latex", entryFile: "main.tex", supportedBlocks: [] } as AcademicTemplateManifest,
      templateFiles: [{ path: "Thesis.tex", buffer: Buffer.from("\\documentclass{ctexbook}\n\\usepackage[backend=biber]{biblatex}") }],
    });
    expect(result.mainTex).not.toContain("\\usepackage[backend=biber,style=numeric]{biblatex}");
    expect(result.generatedContentTex).toContain("\\printbibliography");
  });

  it("ignores commented package examples in a pinned entry source", () => {
    const result = renderAcademicDocumentToLatex(buildEmptyAcademicDocument("论文"), {
      manifest: { id: "neu", university: "东北大学", format: "latex", entryFile: "Thesis.tex", documentClass: "neuthesis", supportedBlocks: [] } as AcademicTemplateManifest,
      templateFiles: [{ path: "Thesis.tex", buffer: Buffer.from("% \\usepackage[option1,option2]{artratex}\n\\usepackage[bibtex]{Style/artratex}") }],
    });
    expect(result.mainTex).toContain("\\usepackage[bibtex]{Style/artratex}");
    expect(result.mainTex).not.toContain("option1");
  });

  it("infers chapter-style abstracts from a custom class base", () => {
    const result = renderAcademicDocumentToLatex(buildSampleAcademicDocument(), {
      manifest: { id: "neu", university: "东北大学", format: "latex", documentClass: "neuthesis", supportedBlocks: [] } as AcademicTemplateManifest,
      templateFiles: [{ path: "neuthesis.cls", buffer: Buffer.from("\\LoadClass{ctexbook}") }],
    });
    expect(result.generatedContentTex).toContain("\\chapter*{摘要}");
    expect(result.generatedContentTex).not.toContain("\\begin{abstract}");
  });

  it("does not override a bibliography style declared by the template", () => {
    const result = renderAcademicDocumentToLatex(buildSampleAcademicDocument(), {
      manifest: { id: "neu", university: "东北大学", format: "latex", bibliography: "bibtex", documentClass: "neuthesis", supportedBlocks: [] } as AcademicTemplateManifest,
      templateFiles: [{ path: "artratex.sty", buffer: Buffer.from("\\bibliographystyle{gbt7714-unsrt}") }],
    });
    expect(result.generatedContentTex).toContain("\\bibliography{references}");
    expect(result.generatedContentTex).not.toContain("\\bibliographystyle{plain}");
  });

  it("does not confuse lowercase author definitions with a case-sensitive Author adapter", () => {
    const result = renderAcademicDocumentToLatex(buildSampleAcademicDocument(), {
      manifest: { id: "generic", university: "示例", format: "latex", documentClass: "book", supportedBlocks: [] } as AcademicTemplateManifest,
      templateFiles: [{ path: "main.tex", buffer: Buffer.from("\\documentclass{book}\n\\newcommand{\\author}[1]{}") }],
    });
    expect(result.mainTex).not.toContain("\\Author{");
  });
});
