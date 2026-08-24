import { describe, expect, it } from "vitest";
import { applyDocumentPatch, assertPatchBaseVersion, documentPatchSchema } from "./document-patches";
import { buildEmptyAcademicDocument } from "./document-schema";

describe("document patches", () => {
  it("applies a replace operation without mutating the source", () => {
    const original = buildEmptyAcademicDocument();
    const patched = applyDocumentPatch(original, {
      schemaVersion: "1",
      baseVersion: 1,
      summary: "更新标题",
      operations: [{ kind: "replace_block", blockId: "section-1", block: { kind: "heading", id: "section-1", level: 1, children: [{ kind: "text", text: "研究方法" }] } }],
    });
    expect(patched.blocks.find((block) => "id" in block && block.id === "section-1")).toMatchObject({ kind: "heading" });
    expect(original.blocks.find((block) => "id" in block && block.id === "section-1")).toMatchObject({ kind: "heading" });
  });

  it("requires the patch to target the current version", () => {
    expect(() => assertPatchBaseVersion(2, { schemaVersion: "1", baseVersion: 1, summary: "", operations: [] })).toThrow();
  });

  it("shares strict validation for user and AI patches", () => {
    expect(documentPatchSchema.safeParse({ schemaVersion: "1", baseVersion: 1, summary: "", operations: [] }).success).toBe(false);
    expect(documentPatchSchema.safeParse({ schemaVersion: "1", baseVersion: 1, summary: "新增正文", operations: [{ kind: "insert_block", index: 1, block: { kind: "paragraph", id: "p-2", children: [{ kind: "text", text: "新内容" }] } }] }).success).toBe(true);
  });

  it("keeps paper metadata immutable through patches", () => {
    const original = buildEmptyAcademicDocument("论文");
    expect(original.blocks[0].kind).toBe("paper_metadata");
    expect(() => applyDocumentPatch(original, { schemaVersion: "1", baseVersion: 1, summary: "delete metadata", operations: [{ kind: "delete_block", blockId: "metadata" }] })).toThrow("找不到");
  });
});
