import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { AcademicTemplateManifest } from "./template-registry";
import { githubRepositorySlug, normalizeTemplateZip, resolveTemplateBibliography, resolveTemplateClassOptions, resolveTemplateDocumentClass } from "./template-snapshot";

describe("template upstream snapshots", () => {
  it("accepts only GitHub owner/repository identities", () => {
    expect(githubRepositorySlug("https://github.com/tuna/thuthesis.git")).toBe("tuna/thuthesis");
    expect(githubRepositorySlug("https://example.com/tuna/thuthesis")).toBeNull();
  });

  it("strips archive roots and rejects unsafe files through the shared policy", async () => {
    const zip = new JSZip();
    zip.file("repo-v1/main.tex", "\\documentclass{article}");
    zip.file("repo-v1/assets/figure.png", Buffer.from([1, 2, 3]));
    const result = await normalizeTemplateZip(await zip.generateAsync({ type: "nodebuffer" }));
    const repeated = await normalizeTemplateZip(await zip.generateAsync({ type: "nodebuffer" }));
    expect(result.files).toEqual(["assets/figure.png", "main.tex"]);
    expect(result.sha256).toHaveLength(64);
    expect(repeated.sha256).toBe(result.sha256);
    expect(repeated.buffer.equals(result.buffer)).toBe(true);
  });

  it("infers a custom class from pinned files without selecting bundled generic classes", () => {
    expect(resolveTemplateDocumentClass(
      { id: "uestc", university: "电子科技大学", repositoryUrl: "https://github.com/example/uestc", documentClass: null },
      [
        { path: "template/dependencies/tex/latex/base/book.cls" },
        { path: "template/dependencies/tex/latex/ctex/ctexbook.cls" },
        { path: "template/uestcthesis.cls" },
      ],
    )).toBe("uestcthesis");
    expect(resolveTemplateDocumentClass(
      { id: "plain", university: "示例", repositoryUrl: null, documentClass: null },
      [{ path: "article.cls" }],
    )).toBeNull();
    expect(resolveTemplateDocumentClass(
      { id: "jnu", university: "暨南大学", repositoryUrl: "https://github.com/example/jnu", documentClass: null },
      [{ path: "JNUThesis.tex", buffer: Buffer.from("\\documentclass{book}") }],
    )).toBe("book");
    expect(resolveTemplateDocumentClass(
      { id: "nuaa", university: "南京航空航天大学", repositoryUrl: "https://github.com/example/nuaa", documentClass: null },
      [{ path: "nuaathesis.dtx", buffer: Buffer.from("\\ProvidesClass{nuaathesis}") }],
    )).toBe("nuaathesis");
  });

  it("uses documented degree option shapes for common thesis classes", () => {
    expect(resolveTemplateClassOptions({ degreeType: "硕士" }, "thuthesis")).toEqual(["master"]);
    expect(resolveTemplateClassOptions({ degreeType: "博士" }, "shtthesis")).toEqual(["doctor"]);
    expect(resolveTemplateClassOptions({ degreeType: "本科" }, "buctthesis")).toEqual(["type=bachelor"]);
    expect(resolveTemplateClassOptions({ degreeType: "硕士" }, "jnuthesis")).toEqual(["master"]);
    expect(resolveTemplateClassOptions({ degreeType: "硕士" }, "nuaathesis")).toEqual(["degree=master", "fontset=fandol"]);
  });

  it("prefers the pinned class bibliography implementation over stale registry metadata", () => {
    const manifest = { id: "demo", university: "示例", format: "latex", supportedBlocks: [], bibliography: "biblatex-gb7714-2015" } satisfies AcademicTemplateManifest;
    expect(resolveTemplateBibliography(manifest, [{ path: "demo.cls", buffer: Buffer.from("\\RequirePackage{natbib}") }]).bibliography).toBe("bibtex");
    expect(resolveTemplateBibliography(manifest, [{ path: "demo.cls", buffer: Buffer.from("\\RequirePackage{biblatex}") }]).bibliography).toBe("biblatex-gb7714-2015");
    expect(resolveTemplateBibliography({ ...manifest, bibliography: null }, [{ path: "demo.cls", buffer: Buffer.from("\\RequirePackage{biblatex}") }]).bibliography).toBe("biblatex");
  });
});
