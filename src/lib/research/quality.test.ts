import { describe, expect, it } from "vitest";
import { computeEvidenceRecency, computeResearchInformationGain, computeSourceDiversity, estimateSourceQuality, summarizeResearchQuality } from "./quality";

describe("research quality dimensions", () => {
  it("uses source kinds and recency as explainable quality inputs", () => {
    expect(estimateSourceQuality("academic")).toBeGreaterThan(estimateSourceQuality("web"));
    expect(computeSourceDiversity(["academic", "academic", "official_document"])).toBeCloseTo(2 / 3);
    expect(computeEvidenceRecency([new Date("2026-01-01")], new Date("2026-01-02"))).toBeGreaterThan(0.9);
    expect(computeResearchInformationGain(2, 3)).toBeCloseTo(1 / 3);
    expect(computeResearchInformationGain(3, 3)).toBe(0);
  });

  it("labels conflict independently from aggregate score", () => {
    expect(summarizeResearchQuality({ sourceQuality: 1, evidenceDirectness: 1, independentCorroboration: 1, sourceDiversity: 1, conflict: 0.8, coverage: 1, recency: 1 })).toEqual({ score: 0.971, label: "存在争议" });
  });
});
