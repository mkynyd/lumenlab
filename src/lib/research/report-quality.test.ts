import { describe, expect, it } from "vitest";
import { deterministicReportAudit, evidenceMarkersInReport, normalizeReportArchitecture } from "./report-quality";

describe("report quality gate", () => {
  it("rejects the former deterministic bullet fallback and unknown citations", () => {
    const report = "## 研究结论\n\n本次研究围绕 X 形成以下可核验结论：\n\n- 论文 A [E1]\n- 论文 B [E9]\n\n## 限制\n\n以上内容只代表当前 Run 已成功读取的来源与核验状态。";
    const audit = deterministicReportAudit({ report, evidenceRefs: ["ev-1"], claims: [] });
    expect(audit.pass).toBe(false);
    expect(audit.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["deterministic_fallback_language", "unknown_evidence_marker"]));
  });

  it("extracts cited evidence in first-appearance order", () => {
    expect(evidenceMarkersInReport("结论 [E2]，再看 [E1] 与 [E2]。")).toEqual([2, 1, 2]);
  });

  it("drops unknown claim ids from the architecture", () => {
    const result = normalizeReportArchitecture({ thesis: "综合判断", sections: [{ title: "机制分类", question: "有哪些方向", claimIds: ["c1", "unknown"], comparisonDimensions: ["机制"], importance: "high" }], uncertainties: [], excludedClaimIds: [] }, new Set(["c1"]));
    expect(result?.sections[0].claimIds).toEqual(["c1"]);
  });

  it("rejects a globally valid marker that is unrelated to any reportable claim", () => {
    const claims = [{ id: "c1", statement: "可支持的命题陈述足够长。", status: "verified", qualifiers: [], evidence: [{ marker: "E1", relation: "supports", statement: "证据", excerpt: "证据", source: { title: "A", canonicalKey: "a", year: null, venue: null, assessment: null } }] }] as never;
    const report = `## 综合判断\n\n${"这是一个基于多来源证据形成的综合分析段落。".repeat(12)} [E2]`;
    const audit = deterministicReportAudit({ report, evidenceRefs: ["ev-1", "ev-2"], claims });
    expect(audit.issues.map((issue) => issue.code)).toContain("unrelated_evidence_marker");
  });
});
