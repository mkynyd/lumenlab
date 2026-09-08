import { describe, expect, it } from "vitest";
import { assertEvidenceRevisionInput, normalizeEvidenceTags, isUserEditableEvidenceStatus } from "./evidence";

describe("research evidence revisions", () => {
  it("normalizes user tags without mutating the source extraction", () => {
    expect(normalizeEvidenceTags([" Official ", "official", "医学", ""])).toEqual(["official", "医学"]);
  });

  it("only permits explicit reliability statuses and validates replacement content", () => {
    expect(isUserEditableEvidenceStatus("disputed")).toBe(true);
    expect(isUserEditableEvidenceStatus("active")).toBe(false);
    expect(() => assertEvidenceRevisionInput({ statement: "x", excerpt: "ok", evidenceType: "paraphrase" })).toThrow();
    expect(() => assertEvidenceRevisionInput({ statement: "新的事实", excerpt: "原文摘录", evidenceType: "paraphrase" })).not.toThrow();
  });
});
