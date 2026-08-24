import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import type { AcademicTemplateManifest } from "./template-registry";
import { buildDtxBootstrapPlan, findTemplateInstaller, githubRepositorySlug, normalizeTemplateRuntimeBuffer, normalizeTemplateTarGz, normalizeTemplateZip, resolveTemplateBibliography, resolveTemplateClassOptions, resolveTemplateDocumentClass } from "./template-snapshot";

describe("template upstream snapshots", () => {
  it("accepts only GitHub owner/repository identities", () => {
    expect(githubRepositorySlug("https://github.com/tuna/thuthesis.git")).toBe("tuna/thuthesis");
    expect(githubRepositorySlug("https://example.com/tuna/thuthesis")).toBeNull();
  });

  it("normalizes only legacy Template-relative class references at runtime", () => {
    const source = Buffer.from("\\input{../Template/scuthesis.def}\n\\input{../Other/file}");
    expect(normalizeTemplateRuntimeBuffer("Template/scuthesis.cls", source).toString()).toContain("\\input{Template/scuthesis.def}");
    expect(normalizeTemplateRuntimeBuffer("Template/scuthesis.cls", source).toString()).toContain("../Other/file");
    expect(normalizeTemplateRuntimeBuffer("README.md", source)).toBe(source);
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

  it("normalizes a public Typst tar.gz package deterministically", async () => {
    const tarHeader = (name: string, content: Buffer) => {
      const header = Buffer.alloc(512);
      header.write(name, 0, 100, "utf8");
      header.write("0000644", 100, 8, "ascii");
      header.write(content.byteLength.toString(8).padStart(11, "0"), 124, 12, "ascii");
      header[156] = 48;
      header.write("ustar", 257, 5, "ascii");
      return Buffer.concat([header, content, Buffer.alloc((512 - (content.byteLength % 512)) % 512)]);
    };
    const rawTar = Buffer.concat([tarHeader("README.md", Buffer.from("Typst package")), Buffer.alloc(1024)]);
    const { gzipSync } = await import("node:zlib");
    const result = await normalizeTemplateTarGz(gzipSync(rawTar));
    expect(result.files).toEqual(["README.md"]);
    expect(result.sha256).toHaveLength(64);
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
    expect(resolveTemplateDocumentClass(
      { id: "bnu", university: "北京师范大学", repositoryUrl: "https://github.com/example/bnu", documentClass: "bnu-thesis" },
      [{ path: "bnuthesis.cls", buffer: Buffer.from("\\ProvidesClass{bnuthesis}") }],
    )).toBe("bnuthesis");
    expect(resolveTemplateDocumentClass(
      { id: "xtu", university: "湘潭大学", repositoryUrl: "https://github.com/example/xtu", documentClass: null },
      [
        { path: "reference/IEEEtran.cls" },
        { path: "xtuthesis.tex", buffer: Buffer.from("\\documentclass{ctexbook}") },
      ],
    )).toBe("ctexbook");
    expect(resolveTemplateDocumentClass(
      { id: "hit", university: "哈尔滨工业大学", repositoryUrl: "https://github.com/example/hithesis", documentClass: "hithesis" },
      [
        { path: "hithesis.ins", buffer: Buffer.from("\\file{\\jobname book.cls}{\\from{\\jobname.dtx}{bookcls}}\\file{\\jobname art.cls}{\\from{\\jobname.dtx}{artcls}}") },
        { path: "hithesis.dtx", buffer: Buffer.from("% generated class source") },
      ],
    )).toBe("hithesisbook");
  });

  it("uses documented degree option shapes for common thesis classes", () => {
    expect(resolveTemplateClassOptions({ degreeType: "硕士" }, "thuthesis")).toEqual(["master"]);
    expect(resolveTemplateClassOptions({ degreeType: "博士" }, "shtthesis")).toEqual(["doctor"]);
    expect(resolveTemplateClassOptions({ degreeType: "本科" }, "buctthesis")).toEqual(["type=bachelor"]);
    expect(resolveTemplateClassOptions({ degreeType: "硕士" }, "jnuthesis")).toEqual(["master"]);
    expect(resolveTemplateClassOptions({ degreeType: "硕士" }, "nuaathesis")).toEqual(["degree=master", "fontset=fandol"]);
    expect(resolveTemplateClassOptions({ degreeType: "博士" }, "bnuthesis")).toEqual(["doctor"]);
    expect(resolveTemplateClassOptions({ degreeType: "博士" }, "seuthesiY")).toEqual(["phd"]);
    expect(resolveTemplateClassOptions({ degreeType: "本科" }, "hhuthesis")).toEqual(["bachelor"]);
    expect(resolveTemplateClassOptions({ degreeType: "硕士" }, "scuthesis")).toEqual(["master"]);
  });

  it("bootstraps every generated artifact declared by a DTX installer", () => {
    const plan = buildDtxBootstrapPlan("hustthesis", "hustthesis.dtx", "\\file{\\jobname.cls}{\\from{\\jobname.dtx}{class}}\\file{\\jobname-m.def}{\\from{\\jobname.dtx}{def-m}}\\file{\\jobname.cbx}{\\from{\\jobname.dtx}{cbx}}");
    expect(plan.outputFiles).toEqual(["hustthesis.cls", "hustthesis-m.def", "hustthesis.cbx"]);
    expect(plan.installerSource).toContain("\\file{hustthesis-m.def}{\\from{hustthesis.dtx}{def-m}}");
  });

  it("finds an installer whose jobname-derived output matches the selected class", () => {
    expect(findTemplateInstaller("hithesisbook", [
      { path: "hithesis.ins", buffer: Buffer.from("\\file{\\jobname book.cls}{\\from{\\jobname.dtx}{bookcls}}") },
    ])?.path).toBe("hithesis.ins");
  });

  it("prefers the pinned class bibliography implementation over stale registry metadata", () => {
    const manifest = { id: "demo", university: "示例", format: "latex", supportedBlocks: [], bibliography: "biblatex-gb7714-2015" } satisfies AcademicTemplateManifest;
    expect(resolveTemplateBibliography(manifest, [{ path: "demo.cls", buffer: Buffer.from("\\RequirePackage{natbib}") }]).bibliography).toBe("bibtex");
    expect(resolveTemplateBibliography(manifest, [{ path: "demo.cls", buffer: Buffer.from("\\RequirePackage{biblatex}") }]).bibliography).toBe("biblatex-gb7714-2015");
    expect(resolveTemplateBibliography({ ...manifest, bibliography: null }, [{ path: "demo.cls", buffer: Buffer.from("\\RequirePackage{biblatex}") }]).bibliography).toBe("biblatex");
    expect(resolveTemplateBibliography({ ...manifest, id: "neu", documentClass: "neuthesis", entryFile: "Thesis.tex" }, [{ path: "Thesis.tex", buffer: Buffer.from("\\usepackage[bibtex,myhdr]{Style/artratex}") }]).bibliography).toBe("bibtex");
  });

  it("does not infer biblatex from a conditional implementation-only style branch", () => {
    expect(resolveTemplateBibliography(
      { id: "suda", university: "苏州大学", format: "latex", documentClass: "sudathesis", entryFile: "Thesis.tex", bibliography: null, supportedBlocks: [] } as AcademicTemplateManifest,
      [
        { path: "Thesis.tex", buffer: Buffer.from("\\documentclass{style/sudathesis}\\usepackage[super,list,xlink]{style/artratex}") },
        { path: "Style/artratex.sty", buffer: Buffer.from("\\ifartx@biber\\RequirePackage[backend=biber]{biblatex}\\fi") },
      ],
    ).bibliography).toBeNull();
  });
});
