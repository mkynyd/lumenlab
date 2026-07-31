import type {
  ContentFreshness,
  MasteryState,
  PracticeMode,
} from "../contracts";
import { deriveFreshness } from "../policy";

export type MaterialSnapshot = Readonly<{
  fileAssetId: string;
  contentFingerprint: string;
}>;

export type MaterialReplacement = Readonly<{
  removedFileAssetId: string;
  replacementFileAssetId: string;
}>;

export type MaterialSourceAnchor = Readonly<{
  anchorId: string;
  fileAssetId: string;
  recordedFingerprint: string;
}>;

type LearningMaterialObjectBase = Readonly<{
  objectId: string;
  lineageId: string;
  anchors: readonly MaterialSourceAnchor[];
}>;

export type LearningMaterialObject =
  | (LearningMaterialObjectBase &
      Readonly<{
        objectKind: "knowledge_point";
      }>)
  | (LearningMaterialObjectBase &
      Readonly<{
        objectKind: "practice_item";
        practiceMode: PracticeMode;
      }>);

export type HistoricalEvidenceBytes = Readonly<{
  evidenceId: string;
  lineageId: string;
  serialized: string;
}>;

export type LineageProgressSnapshot = Readonly<{
  lineageId: string;
  masteryState: MasteryState;
}>;

export type MaterialChangeInput = Readonly<{
  materials: readonly MaterialSnapshot[];
  replacements?: readonly MaterialReplacement[];
  objects: readonly LearningMaterialObject[];
  lineageProgress: readonly LineageProgressSnapshot[];
  historicalEvidence: readonly HistoricalEvidenceBytes[];
}>;

export type MaterialChangeDecision = Readonly<{
  objectId: string;
  objectKind: LearningMaterialObject["objectKind"];
  lineageId: string;
  practiceMode: PracticeMode | null;
  freshness: "current" | "needs_revalidation" | "unsupported";
  inheritedMasteryState: MasteryState;
  countsTowardCurrentMastered: boolean;
  evidenceEligible: boolean;
  unchangedAnchorIds: readonly string[];
  changedAnchorIds: readonly string[];
  missingAnchorIds: readonly string[];
  resolvedFileAssetIds: readonly string[];
}>;

export class MaterialFreshnessGateError extends Error {
  readonly code = "source_unsupported" as const;
  readonly objectId: string;
  readonly reason: Exclude<ContentFreshness, "current">;

  constructor(
    decision: Pick<
      MaterialChangeDecision,
      "objectId" | "freshness"
    >,
  ) {
    super(
      decision.freshness === "unsupported"
        ? "The practice item no longer has a supported source."
        : "The practice item requires current-source revalidation.",
    );
    this.name = "MaterialFreshnessGateError";
    this.objectId = decision.objectId;
    this.reason =
      decision.freshness === "unsupported"
        ? "unsupported"
        : "needs_revalidation";
  }
}

/**
 * Fail-closed gate for the attempt boundary. Feedback-only work can still
 * receive instruction, but a stale evidence-bearing item cannot create current
 * mastery evidence.
 */
export function assertEvidenceBearingSubmissionAllowed(
  decision: MaterialChangeDecision,
): void {
  if (
    decision.objectKind === "practice_item" &&
    decision.practiceMode === "evidence_bearing" &&
    decision.freshness !== "current"
  ) {
    throw new MaterialFreshnessGateError(decision);
  }
}

export type MaterialChangeResult = Readonly<{
  decisions: readonly MaterialChangeDecision[];
  affectedObjectIds: readonly string[];
  currentMasteredCount: number;
  historicalEvidence: readonly HistoricalEvidenceBytes[];
  preservesHistoricalEvidence: true;
}>;

/**
 * Pure adapter between FileAsset content versions and learning freshness.
 *
 * It deliberately returns an immutable decision report instead of mutating
 * attempts, evaluations, or progress. The opaque serialized evidence is passed
 * through by reference so callers can verify that rebuilding the projection
 * does not rewrite historical evidence.
 */
export function evaluateMaterialChange(
  input: MaterialChangeInput,
): MaterialChangeResult {
  const currentFingerprintByFileId = new Map(
    input.materials.map((material) => [
      material.fileAssetId,
      material.contentFingerprint,
    ]),
  );
  const replacementByRemovedFileId = new Map(
    (input.replacements ?? []).map((replacement) => [
      replacement.removedFileAssetId,
      replacement.replacementFileAssetId,
    ]),
  );
  const masteryByLineageId = new Map(
    input.lineageProgress.map((progress) => [
      progress.lineageId,
      progress.masteryState,
    ]),
  );

  const decisions = input.objects.map((object): MaterialChangeDecision => {
    const inheritedMasteryState =
      masteryByLineageId.get(object.lineageId) ?? "new";
    const resolvedFileAssetIds: string[] = [];
    const freshness = deriveFreshness({
      anchors: object.anchors.map((anchor) => {
        const directFingerprint = currentFingerprintByFileId.get(
          anchor.fileAssetId,
        );
        if (directFingerprint !== undefined) {
          resolvedFileAssetIds.push(anchor.fileAssetId);
          return {
            anchorId: anchor.anchorId,
            recordedFingerprint: anchor.recordedFingerprint,
            currentFingerprint: directFingerprint,
          };
        }

        const replacementFileAssetId = replacementByRemovedFileId.get(
          anchor.fileAssetId,
        );
        const replacementFingerprint =
          replacementFileAssetId === undefined
            ? undefined
            : currentFingerprintByFileId.get(replacementFileAssetId);
        if (
          replacementFileAssetId !== undefined &&
          replacementFingerprint !== undefined
        ) {
          resolvedFileAssetIds.push(replacementFileAssetId);
          return {
            anchorId: anchor.anchorId,
            recordedFingerprint: anchor.recordedFingerprint,
            // A replacement is a new source identity even if its bytes happen
            // to match. Force the public fingerprint comparison to classify it
            // as changed so current evidence must be revalidated.
            currentFingerprint:
              `replacement:${replacementFileAssetId}:${replacementFingerprint}`,
          };
        }

        return {
          anchorId: anchor.anchorId,
          recordedFingerprint: anchor.recordedFingerprint,
          currentFingerprint: null,
        };
      }),
    });
    return Object.freeze({
      objectId: object.objectId,
      objectKind: object.objectKind,
      lineageId: object.lineageId,
      practiceMode:
        object.objectKind === "practice_item"
          ? object.practiceMode
          : null,
      freshness: freshness.freshness,
      inheritedMasteryState,
      countsTowardCurrentMastered:
        object.objectKind === "knowledge_point" &&
        inheritedMasteryState === "mastered" &&
        freshness.freshness === "current",
      evidenceEligible: freshness.evidenceEligible,
      unchangedAnchorIds: freshness.unchangedAnchorIds,
      changedAnchorIds: freshness.changedAnchorIds,
      missingAnchorIds: freshness.missingAnchorIds,
      resolvedFileAssetIds: Object.freeze([
        ...new Set(resolvedFileAssetIds),
      ]),
    });
  });

  return Object.freeze({
    decisions: Object.freeze(decisions),
    affectedObjectIds: Object.freeze(
      decisions
        .filter((decision) => decision.freshness !== "current")
        .map((decision) => decision.objectId),
    ),
    currentMasteredCount: decisions.filter(
      (decision) => decision.countsTowardCurrentMastered,
    ).length,
    historicalEvidence: input.historicalEvidence,
    preservesHistoricalEvidence: true as const,
  });
}
