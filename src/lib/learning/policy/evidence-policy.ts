import type {
  AssistanceLevel,
  EvaluationVerdict,
  PracticeMode,
} from "../contracts";

export const EVIDENCE_POLICY_VERSION = "evidence-v1" as const;

export type SpacingBand = "immediate" | "short" | "spaced";
export type EvidenceStrength = "none" | "weak" | "medium" | "strong";

export type EvidencePolicy = Readonly<{
  version: string;
  immediateUpperBoundSeconds: number;
  spacedLowerBoundSeconds: number;
  weights: Readonly<
    Record<AssistanceLevel, Readonly<Record<SpacingBand, number>>>
  >;
  incorrectPenalty: number;
  partialMultiplier: number;
}>;

export const DEFAULT_EVIDENCE_POLICY: EvidencePolicy = Object.freeze({
  version: EVIDENCE_POLICY_VERSION,
  immediateUpperBoundSeconds: 10 * 60,
  spacedLowerBoundSeconds: 24 * 60 * 60,
  weights: Object.freeze({
    independent: Object.freeze({
      immediate: 0.75,
      short: 0.9,
      spaced: 1,
    }),
    hinted: Object.freeze({
      immediate: 0.25,
      short: 0.45,
      spaced: 0.65,
    }),
    answer_exposed: Object.freeze({
      immediate: 0.05,
      short: 0.2,
      spaced: 0.4,
    }),
  }),
  incorrectPenalty: -0.6,
  partialMultiplier: 0.5,
});

export type EvaluateEvidenceInput = Readonly<{
  mode: PracticeMode;
  verdict: EvaluationVerdict;
  score: number | null;
  assistanceLevel: AssistanceLevel;
  spacingSeconds: number;
}>;

export type EvidenceDecision = Readonly<{
  policyVersion: string;
  eligibleForMastery: boolean;
  spacingBand: SpacingBand;
  strength: EvidenceStrength;
  contribution: number;
  correct: boolean;
  spaced: boolean;
}>;

function spacingBandFor(
  spacingSeconds: number,
  policy: EvidencePolicy,
): SpacingBand {
  const elapsed = Math.max(0, spacingSeconds);
  if (elapsed < policy.immediateUpperBoundSeconds) {
    return "immediate";
  }
  if (elapsed < policy.spacedLowerBoundSeconds) {
    return "short";
  }
  return "spaced";
}
function strengthFor(
  contribution: number,
  verdict: EvaluationVerdict,
): EvidenceStrength {
  if (verdict === "uncertain" || contribution === 0) {
    return "none";
  }
  const magnitude = Math.abs(contribution);
  if (magnitude >= 0.8) {
    return "strong";
  }
  if (magnitude >= 0.4) {
    return "medium";
  }
  return "weak";
}

function clampScore(score: number | null): number {
  if (score === null || !Number.isFinite(score)) {
    return 0;
  }
  return Math.min(1, Math.max(0, score));
}

/**
 * Converts a frozen evaluation plus server-observed help/spacing metadata into
 * one versioned evidence decision. Planned review dates are intentionally not
 * accepted: only actual elapsed spacing can affect this decision.
 */
export function evaluateEvidence(
  input: EvaluateEvidenceInput,
  policy: EvidencePolicy = DEFAULT_EVIDENCE_POLICY,
): EvidenceDecision {
  const spacingBand = spacingBandFor(input.spacingSeconds, policy);
  const spaced = spacingBand === "spaced";
  const correct = input.verdict === "correct";

  if (input.mode === "feedback_only") {
    return Object.freeze({
      policyVersion: policy.version,
      eligibleForMastery: false,
      spacingBand,
      strength: "none",
      contribution: 0,
      correct,
      spaced,
    });
  }

  let contribution = 0;
  if (input.verdict === "correct") {
    contribution =
      policy.weights[input.assistanceLevel][spacingBand] *
      (input.score === null ? 1 : clampScore(input.score));
  } else if (input.verdict === "partial") {
    contribution =
      policy.weights[input.assistanceLevel][spacingBand] *
      clampScore(input.score) *
      policy.partialMultiplier;
  } else if (input.verdict === "incorrect") {
    contribution = policy.incorrectPenalty;
  }

  const eligibleForMastery =
    correct &&
    contribution > 0 &&
    !(
      input.assistanceLevel === "answer_exposed" &&
      spacingBand === "immediate"
    );

  return Object.freeze({
    policyVersion: policy.version,
    eligibleForMastery,
    spacingBand,
    strength: strengthFor(contribution, input.verdict),
    contribution,
    correct,
    spaced,
  });
}
