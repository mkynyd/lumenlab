import { describe, expect, it } from "vitest";
import { buildEmptyAcademicDocument, parseAcademicDocument, serializeAcademicDocument } from "./document-schema";

describe("academic document schema", () => {
  it("creates a valid structured document", () => {
    const document = buildEmptyAcademicDocument("测试论文");
    expect(document.blocks.some((block) => block.kind === "heading")).toBe(true);
    expect(parseAcademicDocument(JSON.parse(serializeAcademicDocument(document))).schemaVersion).toBe("1");
  });

  it("rejects unknown block kinds", () => {
    expect(() => parseAcademicDocument({ schemaVersion: "1", title: "x", blocks: [{ kind: "html" }] })).toThrow();
  });
});
