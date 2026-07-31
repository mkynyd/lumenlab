import type { ContentFreshness } from "../contracts";

export type FreshnessAnchor = Readonly<{
  anchorId: string;
  recordedFingerprint: string;
  currentFingerprint: string | null;
}>;

export type DeriveFreshnessInput = Readonly<{
  anchors: readonly FreshnessAnchor[];
}>;

export type FreshnessDecision = Readonly<{
  freshness: ContentFreshness;
  unchangedAnchorIds: readonly string[];
  changedAnchorIds: readonly string[];
  missingAnchorIds: readonly string[];
  preservesHistoricalEvidence: true;
  evidenceEligible: boolean;
}>;

/**
 * Compares persisted source fingerprints with the current source snapshot.
 * The returned classification gates new evidence; it never mutates or deletes
 * the historical attempts that were valid under an earlier snapshot.
 */
export function deriveFreshness({
  anchors,
}: DeriveFreshnessInput): FreshnessDecision {
  const unchangedAnchorIds: string[] = [];
  const changedAnchorIds: string[] = [];
  const missingAnchorIds: string[] = [];

  for (const anchor of anchors) {
    if (anchor.currentFingerprint === null) {
      missingAnchorIds.push(anchor.anchorId);
    } else if (anchor.currentFingerprint === anchor.recordedFingerprint) {
      unchangedAnchorIds.push(anchor.anchorId);
    } else {
      changedAnchorIds.push(anchor.anchorId);
    }
  }

  const hasSupportedAnchor =
    unchangedAnchorIds.length + changedAnchorIds.length > 0;
  let freshness: ContentFreshness;
  if (anchors.length === 0 || !hasSupportedAnchor) {
    freshness = "unsupported";
  } else if (
    changedAnchorIds.length > 0 ||
    missingAnchorIds.length > 0
  ) {
    freshness = "needs_revalidation";
  } else {
    freshness = "current";
  }

  return Object.freeze({
    freshness,
    unchangedAnchorIds: Object.freeze(unchangedAnchorIds),
    changedAnchorIds: Object.freeze(changedAnchorIds),
    missingAnchorIds: Object.freeze(missingAnchorIds),
    preservesHistoricalEvidence: true as const,
    evidenceEligible: freshness === "current",
  });
}
