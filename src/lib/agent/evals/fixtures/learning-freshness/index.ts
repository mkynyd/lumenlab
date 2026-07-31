import type { MaterialChangeInput } from "@/lib/learning/freshness/material-change-adapter";

export type LearningFreshnessFixtureExpected = Readonly<{
  affectedObjectIds: readonly string[];
  currentMasteredCount: number;
  decisions: readonly Readonly<{
    objectId: string;
    freshness: "current" | "needs_revalidation" | "unsupported";
    countsTowardCurrentMastered: boolean;
    evidenceEligible: boolean;
    gateCode:
      | "source_unsupported"
      | null;
  }>[];
}>;

export type LearningFreshnessFixture = Readonly<{
  id: string;
  input: MaterialChangeInput;
  expected: LearningFreshnessFixtureExpected;
}>;

export const LEARNING_FRESHNESS_FIXTURES =
  Object.freeze([
    {
      id: "unchanged-lineage-inherits-mastery",
      input: {
        materials: [
          {
            fileAssetId: "file-basics",
            contentFingerprint: "sha256:basics-v1",
          },
        ],
        objects: [
          {
            objectId: "point-basics-v2",
            objectKind: "knowledge_point",
            lineageId: "lineage-basics",
            anchors: [
              {
                anchorId: "anchor-basics",
                fileAssetId: "file-basics",
                recordedFingerprint: "sha256:basics-v1",
              },
            ],
          },
        ],
        lineageProgress: [
          {
            lineageId: "lineage-basics",
            masteryState: "mastered",
          },
        ],
        historicalEvidence: [
          {
            evidenceId: "evidence-basics",
            lineageId: "lineage-basics",
            serialized:
              "{\"attemptId\":\"attempt-basics\",\"verdict\":\"correct\"}",
          },
        ],
      },
      expected: {
        affectedObjectIds: [],
        currentMasteredCount: 1,
        decisions: [
          {
            objectId: "point-basics-v2",
            freshness: "current",
            countsTowardCurrentMastered: true,
            evidenceEligible: true,
            gateCode: null,
          },
        ],
      },
    },
    {
      id: "changed-source-isolated-revalidation",
      input: {
        materials: [
          {
            fileAssetId: "file-affected",
            contentFingerprint: "sha256:affected-v2",
          },
          {
            fileAssetId: "file-unrelated",
            contentFingerprint: "sha256:unrelated-v1",
          },
        ],
        objects: [
          {
            objectId: "point-affected",
            objectKind: "knowledge_point",
            lineageId: "lineage-affected",
            anchors: [
              {
                anchorId: "anchor-affected",
                fileAssetId: "file-affected",
                recordedFingerprint: "sha256:affected-v1",
              },
            ],
          },
          {
            objectId: "point-unrelated",
            objectKind: "knowledge_point",
            lineageId: "lineage-unrelated",
            anchors: [
              {
                anchorId: "anchor-unrelated",
                fileAssetId: "file-unrelated",
                recordedFingerprint: "sha256:unrelated-v1",
              },
            ],
          },
        ],
        lineageProgress: [
          {
            lineageId: "lineage-affected",
            masteryState: "mastered",
          },
          {
            lineageId: "lineage-unrelated",
            masteryState: "mastered",
          },
        ],
        historicalEvidence: [
          {
            evidenceId: "evidence-affected",
            lineageId: "lineage-affected",
            serialized:
              "{\"attemptId\":\"attempt-affected\",\"answer\":\"known-answer\",\"verdict\":\"correct\"}",
          },
        ],
      },
      expected: {
        affectedObjectIds: ["point-affected"],
        currentMasteredCount: 1,
        decisions: [
          {
            objectId: "point-affected",
            freshness: "needs_revalidation",
            countsTowardCurrentMastered: false,
            evidenceEligible: false,
            gateCode: null,
          },
          {
            objectId: "point-unrelated",
            freshness: "current",
            countsTowardCurrentMastered: true,
            evidenceEligible: true,
            gateCode: null,
          },
        ],
      },
    },
    {
      id: "deleted-source-becomes-unsupported",
      input: {
        materials: [],
        objects: [
          {
            objectId: "item-deleted",
            objectKind: "practice_item",
            lineageId: "lineage-deleted",
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
            lineageId: "lineage-deleted",
            masteryState: "learning",
          },
        ],
        historicalEvidence: [
          {
            evidenceId: "evidence-deleted",
            lineageId: "lineage-deleted",
            serialized:
              "{\"attemptId\":\"attempt-deleted\",\"verdict\":\"incorrect\"}",
          },
        ],
      },
      expected: {
        affectedObjectIds: ["item-deleted"],
        currentMasteredCount: 0,
        decisions: [
          {
            objectId: "item-deleted",
            freshness: "unsupported",
            countsTowardCurrentMastered: false,
            evidenceEligible: false,
            gateCode: "source_unsupported",
          },
        ],
      },
    },
    {
      id: "replacement-source-requires-revalidation",
      input: {
        materials: [
          {
            fileAssetId: "file-replacement",
            contentFingerprint: "sha256:equivalent-content",
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
            objectId: "item-replacement",
            objectKind: "practice_item",
            lineageId: "lineage-replacement",
            practiceMode: "evidence_bearing",
            anchors: [
              {
                anchorId: "anchor-original",
                fileAssetId: "file-original",
                recordedFingerprint: "sha256:equivalent-content",
              },
            ],
          },
        ],
        lineageProgress: [
          {
            lineageId: "lineage-replacement",
            masteryState: "mastered",
          },
        ],
        historicalEvidence: [
          {
            evidenceId: "evidence-replacement",
            lineageId: "lineage-replacement",
            serialized:
              "{\"attemptId\":\"attempt-replacement\",\"verdict\":\"correct\"}",
          },
        ],
      },
      expected: {
        affectedObjectIds: ["item-replacement"],
        currentMasteredCount: 0,
        decisions: [
          {
            objectId: "item-replacement",
            freshness: "needs_revalidation",
            countsTowardCurrentMastered: false,
            evidenceEligible: false,
            gateCode: "source_unsupported",
          },
        ],
      },
    },
  ] as const satisfies readonly LearningFreshnessFixture[]);
