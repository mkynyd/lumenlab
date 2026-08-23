import { describe, expect, it } from "vitest";
import { applyDocumentPatch, assertPatchBaseVersion } from "./document-patches";
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
});
