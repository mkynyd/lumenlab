import type { ResearchIntentType } from "./contracts";
import type { ResearchEvaluatorDecision } from "./model-stage";

export interface ResearchEvaluationEvidencePacket {
  sourceRelevance: unknown;
  sourceRole: unknown;
  scope: unknown;
  canonicalSourceIdentity: string;
}

const ANALYTICAL_INTENTS = new Set<ResearchIntentType>(["trend", "comparison", "literature_review", "technical_review"]);

/**
 * Conservative floor used when the evaluator model is unavailable, and as a
 * server-side guard against count-only model decisions. Metadata-only or
 * adjacent evidence never satisfies a completion criterion by itself.
 */
export function deterministicEvaluatorDecision(input: {
  intentType?: ResearchIntentType;
  evidence: ResearchEvaluationEvidencePacket[];
}): ResearchEvaluatorDecision {
  const substantive = input.evidence.filter((item) => item.sourceRelevance === "direct" && item.scope !== "metadata_only");
  const independentSourceCount = new Set(substantive.map((item) => item.canonicalSourceIdentity)).size;
  const primaryEvidencePresent = substantive.some((item) => item.sourceRole === "primary");
  const analytical = input.intentType ? ANALYTICAL_INTENTS.has(input.intentType) : false;
  const resolved = substantive.length > 0 && primaryEvidencePresent && (analytical ? independentSourceCount >= 3 : independentSourceCount >= 1);
  return {
    status: resolved ? "resolved" : substantive.length > 0 ? "partially_resolved" : "unresolved",
    coverage: resolved ? 1 : substantive.length > 0 ? 0.5 : 0,
    directness: substantive.length > 0 ? 0.8 : 0,
    independentSourceCount,
    primaryEvidencePresent,
    conflictState: "none",
    stopReason: resolved ? "completion_criteria_met" : "substantive_direct_evidence_insufficient",
  };
}
