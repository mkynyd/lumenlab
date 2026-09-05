import { describe, expect, it } from "vitest";
import { buildEmptyAcademicDocument, type AcademicDocument } from "./document-schema";
import { buildDocumentOutline, createInsertableBlock, insertDocumentBlock, moveHeadingSubtree, moveHeadingSubtreeTo, removeDocumentBlock, updateDocumentBlockText } from "./document-editor-operations";

describe("document editor operations", () => {
  it("projects nested chapter cards without consuming back matter or changing document order", () => {
    const blocks = [
      { kind: "paper_metadata" }, { kind: "abstract" },
      { kind: "heading", id: "h1", level: 1 }, { kind: "paragraph", id: "p1" },
      { kind: "heading", id: "h2", level: 2 }, { kind: "paragraph", id: "p2" },
      { kind: "heading", id: "h3", level: 1 }, { kind: "bibliography" },
    ];
    const before = structuredClone(blocks);
    const outline = buildDocumentOutline(blocks);
    expect(outline.map((node) => node.index)).toEqual([0, 1, 2, 6, 7]);
    expect(outline[2].children.map((node) => node.index)).toEqual([3, 4]);
    expect(outline[2].children[1].children[0].key).toBe("p2");
    expect(blocks).toEqual(before);
  });

  it("keeps references at the end when moving the last chapter upward", () => {
    const source = buildEmptyAcademicDocument();
    source.blocks.push(createInsertableBlock("heading", "last"), createInsertableBlock("paragraph", "last-body"), createInsertableBlock("bibliography", "refs"));
    const moved = moveHeadingSubtree(source, 4, "up");
    expect(moved.blocks.at(-1)?.kind).toBe("bibliography");
    expect(moved.blocks[2]).toMatchObject({ id: "last" });
    expect(moved.blocks[3]).toMatchObject({ id: "last-body" });
  });
  it("inserts and removes structured blocks without mutating the source", () => {
    const source = buildEmptyAcademicDocument("论文");
    const withQuote = insertDocumentBlock(source, 3, createInsertableBlock("quote", "quote-1"));
    expect(withQuote.blocks[3]).toMatchObject({ kind: "quote", id: "quote-1" });
    expect(source.blocks).toHaveLength(4);
    expect(removeDocumentBlock(withQuote, 3).blocks).toHaveLength(4);
    expect(removeDocumentBlock(source, 0)).toBe(source);
  });

  it("updates only text-backed block children", () => {
    const source = buildEmptyAcademicDocument("论文");
    const updated = updateDocumentBlockText(source, 2, "方法");
    expect(updated.blocks[2]).toMatchObject({ kind: "heading", children: [{ kind: "text", text: "方法" }] });
    expect(updateDocumentBlockText(source, 0, "ignored")).toBe(source);
  });

  it("creates schema-valid non-prose blocks for the editor command menu", () => {
    const source = buildEmptyAcademicDocument("论文");
    expect(insertDocumentBlock(source, 2, createInsertableBlock("table", "table-1")).blocks[2]).toMatchObject({ kind: "table", columns: ["列一", "列二"], rows: [["", ""]] });
    expect(createInsertableBlock("bibliography", "bibliography-1")).toEqual({ kind: "bibliography", referenceIds: [] });
    expect(createInsertableBlock("appendix", "appendix-1")).toMatchObject({ kind: "appendix", title: "附录", blocks: [] });
    expect(createInsertableBlock("page_break", "page-break-1")).toEqual({ kind: "page_break", id: "page-break-1" });
  });

  it("moves a whole heading subtree, not only the heading node", () => {
    const source = buildEmptyAcademicDocument("论文");
    const document: AcademicDocument = {
      ...source,
      blocks: [
        source.blocks[0],
        { kind: "heading", id: "h1", level: 1, children: [{ kind: "text", text: "一" }] },
        { kind: "paragraph", id: "p1", children: [{ kind: "text", text: "一的正文" }] },
        { kind: "heading", id: "h2", level: 2, children: [{ kind: "text", text: "一.一" }] },
        { kind: "paragraph", id: "p2", children: [{ kind: "text", text: "一.一的正文" }] },
        { kind: "heading", id: "h3", level: 1, children: [{ kind: "text", text: "二" }] },
        { kind: "paragraph", id: "p3", children: [{ kind: "text", text: "二的正文" }] },
      ],
    };
    const moved = moveHeadingSubtree(document, 1, "down");
    expect(moved.blocks.map((block) => "id" in block ? block.id : block.kind)).toEqual(["paper_metadata", "h3", "p3", "h1", "p1", "h2", "p2"]);
    expect(moveHeadingSubtree(document, 1, "up")).toBe(document);
  });

  it("moves a dragged heading subtree before a target heading", () => {
    const source = buildEmptyAcademicDocument("论文");
    const document: AcademicDocument = {
      ...source,
      blocks: [
        source.blocks[0],
        { kind: "heading", id: "h1", level: 1, children: [{ kind: "text", text: "一" }] },
        { kind: "paragraph", id: "p1", children: [{ kind: "text", text: "一的正文" }] },
        { kind: "heading", id: "h2", level: 1, children: [{ kind: "text", text: "二" }] },
        { kind: "paragraph", id: "p2", children: [{ kind: "text", text: "二的正文" }] },
        { kind: "heading", id: "h3", level: 1, children: [{ kind: "text", text: "三" }] },
      ],
    };
    const moved = moveHeadingSubtreeTo(document, 1, 5);
    expect(moved.blocks.map((block) => "id" in block ? block.id : block.kind)).toEqual(["paper_metadata", "h2", "p2", "h1", "p1", "h3"]);
    expect(moveHeadingSubtreeTo(document, 1, 2)).toBe(document);
  });
});
