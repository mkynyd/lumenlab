import { describe, expect, it } from "vitest";
import { normalizeImportClassification } from "./import-classifier";

describe("paper import AI classification normalization", () => {
  it("keeps only bounded suggestions for known ambiguous blocks", () => {
    expect(normalizeImportClassification({ suggestions: [
      { index: 2, kind: "figure", confidence: 1.4, reason: "包含图像关系" },
      { index: 9, kind: "heading", confidence: 0.9, reason: "未知块" },
      { index: 1, kind: "unsafe", confidence: 0.9, reason: "不接受" },
    ] }, new Set([1, 2]))).toEqual([
      { index: 2, kind: "figure", confidence: 1, reason: "包含图像关系" },
    ]);
  });

  it("does not treat malformed model output as a document change", () => {
    expect(normalizeImportClassification("not-json", new Set([0]))).toEqual([]);
  });
});
