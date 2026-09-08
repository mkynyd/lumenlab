import { describe, expect, it } from "vitest";
import { linkifyResearchEvidenceMarkers, researchEvidenceIdFromAnchor, researchEvidenceAnchor } from "./report-citations";

describe("research report citation markers", () => {
  it("links only evidence markers that exist in the frozen evidence order", () => {
    expect(linkifyResearchEvidenceMarkers("结论 [E1]，未知 [E3]。", ["ev-1", "ev-2"]))
      .toBe("结论 [E1](#research-evidence-ev-1)，未知 [E3]。");
  });

  it("does not double-link an existing marker", () => {
    expect(linkifyResearchEvidenceMarkers("[E1](#already-linked)", ["ev-1"]))
      .toBe("[E1](#already-linked)");
  });

  it("round-trips encoded evidence ids through report anchors", () => {
    const anchor = researchEvidenceAnchor("ev/with space");
    expect(researchEvidenceIdFromAnchor(anchor)).toBe("ev/with space");
    expect(researchEvidenceIdFromAnchor("#other-anchor")).toBeNull();
  });
});
