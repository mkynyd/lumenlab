import { describe, expect, it } from "vitest";

import {
  assertEvidenceBearingSubmissionAllowed,
  evaluateMaterialChange,
  MaterialFreshnessGateError,
} from "./material-change-adapter";

describe("evaluateMaterialChange", () => {
  it("keeps an unchanged lineage current and eligible for the current mastered count", () => {
    const historicalEvidence = [
      {
        evidenceId: "evidence-1",
        lineageId: "lineage-circuit-law",
        serialized: "{\"verdict\":\"correct\",\"score\":1}",
      },
    ] as const;

    const result = evaluateMaterialChange({
      materials: [
        {
          fileAssetId: "file-circuit",
          contentFingerprint: "sha256:circuit-v1",
        },
      ],
      objects: [
        {
          objectId: "point-circuit-v2",
          objectKind: "knowledge_point",
          lineageId: "lineage-circuit-law",
          anchors: [
            {
              anchorId: "anchor-circuit",
              fileAssetId: "file-circuit",
              recordedFingerprint: "sha256:circuit-v1",
            },
          ],
        },
      ],
      lineageProgress: [
        {
          lineageId: "lineage-circuit-law",
          masteryState: "mastered",
        },
      ],
      historicalEvidence,
    });

    expect(result.decisions).toEqual([
      expect.objectContaining({
        objectId: "point-circuit-v2",
        lineageId: "lineage-circuit-law",
        freshness: "current",
        inheritedMasteryState: "mastered",
        countsTowardCurrentMastered: true,
        evidenceEligible: true,
      }),
    ]);
    expect(result.currentMasteredCount).toBe(1);
    expect(result.historicalEvidence).toBe(historicalEvidence);
  });

  it("isolates a changed file to its anchored object and excludes it from current mastered", () => {
    const historicalEvidence = [
      {
        evidenceId: "evidence-circuit",
        lineageId: "lineage-circuit-law",
        serialized:
          "{\"attempt\":{\"answer\":\"12 V\"},\"evaluation\":{\"verdict\":\"correct\"}}",
      },
    ] as const;
    const before = historicalEvidence[0].serialized;

    const result = evaluateMaterialChange({
      materials: [
        {
          fileAssetId: "file-circuit",
          contentFingerprint: "sha256:circuit-v2",
        },
        {
          fileAssetId: "file-signal",
          contentFingerprint: "sha256:signal-v1",
        },
      ],
      objects: [
        {
          objectId: "point-circuit",
          objectKind: "knowledge_point",
          lineageId: "lineage-circuit-law",
          anchors: [
            {
              anchorId: "anchor-circuit",
              fileAssetId: "file-circuit",
              recordedFingerprint: "sha256:circuit-v1",
            },
          ],
        },
        {
          objectId: "point-signal",
          objectKind: "knowledge_point",
          lineageId: "lineage-signal",
          anchors: [
            {
              anchorId: "anchor-signal",
              fileAssetId: "file-signal",
              recordedFingerprint: "sha256:signal-v1",
            },
          ],
        },
      ],
      lineageProgress: [
        {
          lineageId: "lineage-circuit-law",
          masteryState: "mastered",
        },
        {
          lineageId: "lineage-signal",
          masteryState: "mastered",
        },
      ],
      historicalEvidence,
    });

    expect(result.affectedObjectIds).toEqual(["point-circuit"]);
    expect(result.currentMasteredCount).toBe(1);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        objectId: "point-circuit",
        freshness: "needs_revalidation",
        inheritedMasteryState: "mastered",
        countsTowardCurrentMastered: false,
      }),
      expect.objectContaining({
        objectId: "point-signal",
        freshness: "current",
        countsTowardCurrentMastered: true,
      }),
    ]);
    expect(result.historicalEvidence[0].serialized).toBe(before);
    expect(result.preservesHistoricalEvidence).toBe(true);
  });

  it("marks a deleted source without replacement unsupported and blocks evidence submission", () => {
    const result = evaluateMaterialChange({
      materials: [],
      objects: [
        {
          objectId: "item-deleted-source",
          objectKind: "practice_item",
          lineageId: "lineage-deleted-source",
          practiceMode: "evidence_bearing",
          anchors: [
            {
              anchorId: "anchor-deleted",
              fileAssetId: "file-deleted",
              recordedFingerprint: "sha256:deleted-v1",
            },
          ],
        },
      ],
      lineageProgress: [
        {
          lineageId: "lineage-deleted-source",
          masteryState: "learning",
        },
      ],
      historicalEvidence: [],
    });

    const decision = result.decisions[0];
    expect(decision).toMatchObject({
      freshness: "unsupported",
      evidenceEligible: false,
      missingAnchorIds: ["anchor-deleted"],
    });
    expect(() =>
      assertEvidenceBearingSubmissionAllowed(decision),
    ).toThrowError(
      expect.objectContaining<Partial<MaterialFreshnessGateError>>({
        code: "source_unsupported",
        objectId: "item-deleted-source",
        reason: "unsupported",
      }),
    );
  });

  it("treats a declared replacement as supported but requiring revalidation", () => {
    const result = evaluateMaterialChange({
      materials: [
        {
          fileAssetId: "file-replacement",
          contentFingerprint: "sha256:same-content",
        },
      ],
      replacements: [
        {
          removedFileAssetId: "file-original",
          replacementFileAssetId: "file-replacement",
        },
      ],
      objects: [
        {
          objectId: "item-replaced-source",
          objectKind: "practice_item",
          lineageId: "lineage-replaced-source",
          practiceMode: "evidence_bearing",
          anchors: [
            {
              anchorId: "anchor-original",
              fileAssetId: "file-original",
              recordedFingerprint: "sha256:same-content",
            },
          ],
        },
      ],
      lineageProgress: [
        {
          lineageId: "lineage-replaced-source",
          masteryState: "mastered",
        },
      ],
      historicalEvidence: [],
    });

    const decision = result.decisions[0];
    expect(decision).toMatchObject({
      freshness: "needs_revalidation",
      changedAnchorIds: ["anchor-original"],
      missingAnchorIds: [],
      resolvedFileAssetIds: ["file-replacement"],
      countsTowardCurrentMastered: false,
    });
    expect(() =>
      assertEvidenceBearingSubmissionAllowed(decision),
    ).toThrowError(
      expect.objectContaining<Partial<MaterialFreshnessGateError>>({
        code: "source_unsupported",
        reason: "needs_revalidation",
      }),
    );
  });

  it("does not count a current practice item as a mastered knowledge point", () => {
    const result = evaluateMaterialChange({
      materials: [
        {
          fileAssetId: "file-current-item",
          contentFingerprint: "sha256:current-item",
        },
      ],
      objects: [
        {
          objectId: "item-current",
          objectKind: "practice_item",
          lineageId: "lineage-current-item",
          practiceMode: "evidence_bearing",
          anchors: [
            {
              anchorId: "anchor-current-item",
              fileAssetId: "file-current-item",
              recordedFingerprint: "sha256:current-item",
            },
          ],
        },
      ],
      lineageProgress: [
        {
          lineageId: "lineage-current-item",
          masteryState: "mastered",
        },
      ],
      historicalEvidence: [],
    });

    expect(result.decisions[0]).toMatchObject({
      objectKind: "practice_item",
      freshness: "current",
      inheritedMasteryState: "mastered",
      countsTowardCurrentMastered: false,
    });
    expect(result.currentMasteredCount).toBe(0);
  });
});
