import { describe, expect, it } from "vitest";
import { buildResearchReportStructure, classifyResearchAssertion } from "./report-document";

describe("structured research report document", () => {
  it("classifies important assertion scopes", () => {
    expect(classifyResearchAssertion("A 导致 B")).toBe("causal");
    expect(classifyResearchAssertion("A 与 B 比较存在差异")).toBe("comparative");
    expect(classifyResearchAssertion("普遍认为 A 有效")).toBe("consensus");
    expect(classifyResearchAssertion("A 通常有效")).toBe("generalized");
  });

  it("consolidates claim relations into sections and assertions", () => {
    const structure = buildResearchReportStructure([
      { id: "claim-1", statement: "描述 A", questionId: "q1", questionTitle: "问题一", evidenceRelations: [{ evidenceId: "e1", sourceSnapshotId: "s1", relation: "supports" }] },
      { id: "claim-2", statement: "描述 B", questionId: "q1", questionTitle: "问题一", evidenceRelations: [{ evidenceId: "e1", sourceSnapshotId: "s1", relation: "supports" }, { evidenceId: "e2", sourceSnapshotId: "s2", relation: "contradicts" }] },
    ]);
    expect(structure.sections[0]).toMatchObject({ claimRefs: ["claim-1", "claim-2"], evidenceIds: ["e1", "e2"], sourceSnapshotIds: ["s1", "s2"] });
    expect(structure.assertions[1].citationRefs).toEqual(["s1", "s2"]);
  });
});
