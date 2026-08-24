// @vitest-environment node

import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import { parsePaperImport } from "./importer";

describe("paper deterministic importers", () => {
  it("turns Markdown headings and lists into stable document blocks", () => {
    const result = parsePaperImport({ filename: "demo.md", buffer: Buffer.from("# 研究标题\n\n## 方法\n\n正文。\n\n- A\n- B") });
    expect(result.document.blocks.map((block) => block.kind)).toEqual(["paper_metadata", "heading", "heading", "paragraph", "list"]);
    expect(result.document.title).toBe("研究标题");
  });

  it("preserves unknown LaTeX as a low-confidence raw block", () => {
    const result = parsePaperImport({ filename: "demo.tex", buffer: Buffer.from("\\customenvironment{a}") });
    expect(result.document.blocks.at(-1)?.kind).toBe("raw_latex");
    expect(result.report.lowConfidenceBlocks).toHaveLength(1);
  });

  it("converts standard LaTeX blocks and inline citation structures deterministically", () => {
    const result = parsePaperImport({ filename: "structured.tex", buffer: Buffer.from(String.raw`\documentclass{article}
      \title{结构化论文}
      \author{Alice \and Bob}
      \date{2026}
      \begin{document}
      \maketitle
      \begin{abstract}摘要含有 \cite{ref-a}。\end{abstract}
      \keywords{研究, 论文}
      \section{引言}\label{sec:intro}
      这是 \textbf{重要} 内容，见 \ref{eq:one}，并有 \footnote{脚注}。
      \begin{equation}
        x^2 + y^2 = 1
        \label{eq:one}
      \end{equation}
      \begin{table}[htbp]
        \caption{实验结果}\label{tab:result}
        \begin{tabular}{ll}
          方法 & 结果 \\
          A & 1 \\
        \end{tabular}
      \end{table}
      \begin{itemize}\item 第一项\item 第二项\end{itemize}
      \begin{thebibliography}{9}\bibitem{ref-a} Alice. A paper. 2024.\end{thebibliography}
      \begin{figure}[htbp]\includegraphics{figures/result.png}\caption{结果图}\end{figure}
      \end{document}`) });
    expect(result.document.blocks[0]).toMatchObject({ kind: "paper_metadata", title: "结构化论文", authors: ["Alice", "Bob"], date: "2026" });
    expect(result.document.blocks.map((block) => block.kind)).toEqual(expect.arrayContaining(["abstract", "keywords", "heading", "paragraph", "equation", "table", "list", "bibliography", "raw_latex"]));
    const paragraph = result.document.blocks.find((block) => block.kind === "paragraph");
    expect(paragraph?.kind).toBe("paragraph");
    if (paragraph?.kind === "paragraph") expect(paragraph.children.map((child) => child.kind)).toEqual(expect.arrayContaining(["cross_reference", "footnote"]));
    expect(result.document.blocks.find((block) => block.kind === "equation")).toMatchObject({ label: "eq:one", latex: expect.stringContaining("x^2") });
    expect(result.document.blocks.find((block) => block.kind === "table")).toMatchObject({ caption: "实验结果", label: "tab:result", columns: ["方法", "结果"], rows: [["A", "1"]] });
    expect(result.references).toMatchObject([{ key: "ref-a", title: "Alice. A paper. 2024.", year: 2024 }]);
    expect(result.report.lowConfidenceBlocks.some((item) => item.reason.includes("图片二进制资源"))).toBe(true);
  });

  it("routes DOCX images into structure confirmation instead of silently completing", () => {
    const archive = new AdmZip();
    archive.addFile("word/document.xml", Buffer.from("<w:document><w:body><w:p><w:r><w:t>正文</w:t><w:drawing><wp:inline /></w:drawing></w:r></w:p></w:body></w:document>"));
    const result = parsePaperImport({ filename: "demo.docx", buffer: archive.toBuffer() });
    expect(result.report.lowConfidenceBlocks[0]?.reason).toContain("图片");
  });

  it("extracts DOCX tables, OMML equations, footnotes and embedded assets", () => {
    const archive = new AdmZip();
    archive.addFile("word/document.xml", Buffer.from(`<w:document><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>列一</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>列二</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><m:oMath><m:r><m:t>x^2</m:t></m:r></m:oMath></w:p>
      <w:p><w:r><w:t>正文</w:t><w:footnoteReference w:id="1"/></w:r></w:p>
      <w:p><w:r><w:drawing><wp:inline><wp:docPr descr="实验图"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    </w:body></w:document>`));
    archive.addFile("word/_rels/document.xml.rels", Buffer.from(`<Relationships><Relationship Id="rId1" Target="media/image1.png" Type="image"/></Relationships>`));
    archive.addFile("word/media/image1.png", Buffer.from("png"));
    archive.addFile("word/footnotes.xml", Buffer.from(`<w:footnotes><w:footnote w:id="1"><w:p><w:r><w:t>脚注</w:t></w:r></w:p></w:footnote></w:footnotes>`));
    const result = parsePaperImport({ filename: "rich.docx", buffer: archive.toBuffer() });
    expect(result.assets).toHaveLength(1);
    expect(result.document.blocks.map((block) => block.kind)).toEqual(expect.arrayContaining(["heading", "table", "equation", "paragraph", "figure"]));
    expect(result.document.blocks.find((block) => block.kind === "paragraph")).toMatchObject({ children: [{ kind: "text", text: "正文" }, { kind: "footnote", id: "footnote-1" }] });
  });
});
