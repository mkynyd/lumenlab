import { describe, expect, it } from "vitest";
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
});
