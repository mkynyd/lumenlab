import { describe, expect, it } from "vitest";
import { academicCitationSignal, computeEvidenceRecency, computeResearchInformationGain, computeSourceDiversity, estimateSourceQuality, summarizeResearchQuality } from "./quality";

describe("research quality dimensions", () => {
  it("uses source kinds and recency as explainable quality inputs", () => {
    expect(estimateSourceQuality("academic")).toBeGreaterThan(estimateSourceQuality("web"));
    expect(estimateSourceQuality("academic_paper")).toBe(estimateSourceQuality("academic"));
    expect(computeSourceDiversity(["academic", "academic", "official_document"])).toBeCloseTo(2 / 3);
    expect(computeEvidenceRecency([new Date("2026-01-01")], new Date("2026-01-02"))).toBeGreaterThan(0.9);
    expect(computeResearchInformationGain(2, 3)).toBeCloseTo(1 / 3);
    expect(computeResearchInformationGain(3, 3)).toBe(0);
  });

  it("labels conflict independently from aggregate score", () => {
    expect(summarizeResearchQuality({ sourceQuality: 1, evidenceDirectness: 1, independentCorroboration: 1, sourceDiversity: 1, conflict: 0.8, coverage: 1, recency: 1 })).toEqual({ score: 0.971, label: "存在争议" });
  });

  it("treats citation metrics as a bounded auxiliary signal, never a gate", () => {
    expect(academicCitationSignal({})).toBeNull();
    expect(academicCitationSignal({ citationCount: null, fwci: null })).toBeNull();
    expect(academicCitationSignal({ citationCount: 0 })).toBeNull();
    const high = academicCitationSignal({ citationCount: 100_000, influentialCitationCount: 5_000, fwci: 120 });
    const low = academicCitationSignal({ citationCount: 3 });
    expect(high).not.toBeNull();
    expect(low).not.toBeNull();
    expect(high!).toBeGreaterThan(low!);
    expect(high!).toBeLessThanOrEqual(0.15);
    // 高引用不会把来源直接推满；缺失不会被惩罚
    expect(0.9 + (high ?? 0)).toBeLessThanOrEqual(1.05);
  });
});
