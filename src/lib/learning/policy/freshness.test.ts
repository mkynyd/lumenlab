import { describe, expect, it } from "vitest";

import { deriveFreshness } from "./index";

describe("deriveFreshness", () => {
  it("marks unchanged anchored content current", () => {
    expect(
      deriveFreshness({
        anchors: [
          {
            anchorId: "anchor-1",
            recordedFingerprint: "sha256:a",
            currentFingerprint: "sha256:a",
          },
        ],
      }),
    ).toEqual({
      freshness: "current",
      unchangedAnchorIds: ["anchor-1"],
      changedAnchorIds: [],
      missingAnchorIds: [],
      preservesHistoricalEvidence: true,
      evidenceEligible: true,
    });
  });

  it("marks only affected evidence for revalidation without overwriting history", () => {
    const anchors = [
      {
        anchorId: "anchor-1",
        recordedFingerprint: "sha256:a",
        currentFingerprint: "sha256:b",
      },
      {
        anchorId: "anchor-2",
        recordedFingerprint: "sha256:c",
        currentFingerprint: "sha256:c",
      },
    ];

    expect(deriveFreshness({ anchors })).toEqual({
      freshness: "needs_revalidation",
      unchangedAnchorIds: ["anchor-2"],
      changedAnchorIds: ["anchor-1"],
      missingAnchorIds: [],
      preservesHistoricalEvidence: true,
      evidenceEligible: false,
    });
    expect(anchors[0].recordedFingerprint).toBe("sha256:a");
  });

  it("treats one missing anchor as affected when another anchor is supported", () => {
    expect(
      deriveFreshness({
        anchors: [
          {
            anchorId: "anchor-1",
            recordedFingerprint: "sha256:a",
            currentFingerprint: null,
          },
          {
            anchorId: "anchor-2",
            recordedFingerprint: "sha256:b",
            currentFingerprint: "sha256:b",
          },
        ],
      }),
    ).toMatchObject({
      freshness: "needs_revalidation",
      missingAnchorIds: ["anchor-1"],
      unchangedAnchorIds: ["anchor-2"],
      evidenceEligible: false,
    });
  });

  it("marks absent or wholly unavailable source support unsupported", () => {
    expect(deriveFreshness({ anchors: [] })).toMatchObject({
      freshness: "unsupported",
      evidenceEligible: false,
    });
    expect(
      deriveFreshness({
        anchors: [
          {
            anchorId: "anchor-1",
            recordedFingerprint: "sha256:a",
            currentFingerprint: null,
          },
        ],
      }),
    ).toMatchObject({
      freshness: "unsupported",
      missingAnchorIds: ["anchor-1"],
      preservesHistoricalEvidence: true,
      evidenceEligible: false,
    });
  });
});
