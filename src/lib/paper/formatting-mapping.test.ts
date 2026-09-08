import { describe, expect, it } from "vitest";
import { applyFormattingRoles, buildMappingBatches, protectedDocumentHash, validateMappingBatch } from "./formatting-mapping";
import { parseAcademicDocument } from "./document-schema";

const document = parseAcademicDocument({ schemaVersion: "1", title: "原稿", blocks: [
  { kind: "paragraph", id: "p1", children: [{ kind: "text", text: "Abstract" }] },
  { kind: "paragraph", id: "p2", children: [{ kind: "text", text: "Research conclusion is unchanged." }] },
  { kind: "equation", id: "e1", latex: "x^2" },
  { kind: "figure", id: "f1", assetId: "original", caption: "原图" },
] });
describe("bounded paper structure mapping", () => {
  it("covers long manuscripts beyond the old 140000 character slice", () => {
    const long = parseAcademicDocument({ ...document, blocks: Array.from({ length: 500 }, (_, i) => ({ kind: "paragraph", id: `p${i}`, children: [{ kind: "text", text: "正文".repeat(500) }] })) });
    const batches = buildMappingBatches(long);
    expect(batches.flatMap((b) => b.blocks)).toHaveLength(500);
    expect(batches.at(-1)?.blocks.at(-1)?.blockId).toBe("p499");
    expect(batches.every((b) => b.blocks.length <= 60)).toBe(true);
  });
  it("rejects missing, reordered, duplicate and injected output", () => {
    const batch = buildMappingBatches(document)[0];
    const roles = batch.blocks.map((b) => ({ blockId: b.blockId, role: "keep", confidence: 1 }));
    expect(() => validateMappingBatch({ roles: roles.slice(1) }, batch)).toThrow();
    expect(() => validateMappingBatch({ roles: [...roles].reverse() }, batch)).toThrow();
    expect(() => validateMappingBatch({ roles: roles.map(() => roles[0]) }, batch)).toThrow();
    expect(() => validateMappingBatch({ roles, latex: "injected" }, batch)).toThrow();
    expect(() => validateMappingBatch({ roles: roles.map((r) => r.blockId === "e1" ? { ...r, role: "heading", level: 1 } : r) }, batch)).toThrow();
  });
  it("changes only roles while retaining exact body, formulas and assets", () => {
    const batch = buildMappingBatches(document)[0];
    const roles = validateMappingBatch({ roles: batch.blocks.map((b) => b.blockId === "p2" ? { blockId: b.blockId, role: "abstract_en", confidence: 0.95 } : { blockId: b.blockId, role: "keep", confidence: 1 }) }, batch);
    const mapped = applyFormattingRoles(document, roles);
    expect(mapped.blocks[1].kind).toBe("abstract");
    expect(mapped.blocks.slice(2)).toEqual(document.blocks.slice(2));
    expect(protectedDocumentHash(mapped)).toBe(protectedDocumentHash(document));
    expect(protectedDocumentHash({ ...mapped, blocks: mapped.blocks.slice(1) })).not.toBe(protectedDocumentHash(document));
  });
});
