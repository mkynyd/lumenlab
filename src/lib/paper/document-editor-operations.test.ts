import { describe, expect, it } from "vitest";
import { buildEmptyAcademicDocument, type AcademicDocument } from "./document-schema";
import { createInsertableBlock, insertDocumentBlock, moveHeadingSubtree, removeDocumentBlock, updateDocumentBlockText } from "./document-editor-operations";

describe("document editor operations", () => {
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
});
