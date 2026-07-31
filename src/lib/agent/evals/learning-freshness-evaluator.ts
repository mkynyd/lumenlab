import {
  assertEvidenceBearingSubmissionAllowed,
  evaluateMaterialChange,
  MaterialFreshnessGateError,
} from "@/lib/learning/freshness/material-change-adapter";

import type { LearningFreshnessFixture } from "./fixtures/learning-freshness";

export type LearningFreshnessEvalResult = Readonly<{
  id: string;
  passed: boolean;
  failures: readonly string[];
  affectedObjectIds: readonly string[];
  currentMasteredCount: number;
  historicalEvidenceBytePreserved: boolean;
}>;

export type LearningFreshnessEvalReport = Readonly<{
  schemaVersion: "learning-freshness-audit-v1";
  total: number;
  passed: number;
  failed: number;
  credentialFree: boolean;
  results: readonly LearningFreshnessEvalResult[];
}>;

function isCredentialFree(value: unknown): boolean {
  if (typeof value === "string") {
    return !(
      /(?:sk|ak)-[a-z0-9_-]{12,}/i.test(value) ||
      /bearer\s+[a-z0-9._-]+/i.test(value) ||
      /-----begin [a-z ]*private key-----/i.test(value) ||
      /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(value) ||
      /\/Users\/[^/]+/i.test(value)
    );
  }
  if (Array.isArray(value)) {
    return value.every(isCredentialFree);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).every(
      ([key, entry]) =>
        !/(?:api.?key|authorization|cookie|password|private.?key|secret|token)/i.test(
          key,
        ) && isCredentialFree(entry),
    );
  }
  return true;
}

function gateCode(
  decision: ReturnType<typeof evaluateMaterialChange>["decisions"][number],
) {
  try {
    assertEvidenceBearingSubmissionAllowed(decision);
    return null;
  } catch (error) {
    if (error instanceof MaterialFreshnessGateError) {
      return error.code;
    }
    throw error;
  }
}

function compareLiteral(
  label: string,
  actual: unknown,
  expected: unknown,
  failures: string[],
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label} mismatch`);
  }
}

export function runLearningFreshnessEvals(
  fixtures: readonly LearningFreshnessFixture[],
): LearningFreshnessEvalReport {
  const credentialFree = isCredentialFree(fixtures);
  const results = fixtures.map(
    (fixture): LearningFreshnessEvalResult => {
      const beforeBytes = fixture.input.historicalEvidence.map(
        (entry) => entry.serialized,
      );
      const result = evaluateMaterialChange(fixture.input);
      const afterBytes = result.historicalEvidence.map(
        (entry) => entry.serialized,
      );
      const historicalEvidenceBytePreserved =
        result.historicalEvidence ===
          fixture.input.historicalEvidence &&
        JSON.stringify(afterBytes) === JSON.stringify(beforeBytes);
      const failures: string[] = [];
      compareLiteral(
        "affectedObjectIds",
        result.affectedObjectIds,
        fixture.expected.affectedObjectIds,
        failures,
      );
      compareLiteral(
        "currentMasteredCount",
        result.currentMasteredCount,
        fixture.expected.currentMasteredCount,
        failures,
      );
      compareLiteral(
        "decisions",
        result.decisions.map((decision) => ({
          objectId: decision.objectId,
          freshness: decision.freshness,
          countsTowardCurrentMastered:
            decision.countsTowardCurrentMastered,
          evidenceEligible: decision.evidenceEligible,
          gateCode: gateCode(decision),
        })),
        fixture.expected.decisions,
        failures,
      );
      if (!historicalEvidenceBytePreserved) {
        failures.push("historical evidence bytes changed");
      }
      if (!credentialFree) {
        failures.push("fixture contains credential-like material");
      }
      return Object.freeze({
        id: fixture.id,
        passed: failures.length === 0,
        failures: Object.freeze(failures),
        affectedObjectIds: result.affectedObjectIds,
        currentMasteredCount: result.currentMasteredCount,
        historicalEvidenceBytePreserved,
      });
    },
  );
  const passed = results.filter((result) => result.passed).length;
  return Object.freeze({
    schemaVersion: "learning-freshness-audit-v1" as const,
    total: results.length,
    passed,
    failed: results.length - passed,
    credentialFree,
    results: Object.freeze(results),
  });
}

export function formatLearningFreshnessAudit(
  report: LearningFreshnessEvalReport,
): string {
  return JSON.stringify(report, null, 2);
}
