import {
  toPracticeItemFeedback,
  toPublicPracticeItem,
  type PracticeItemPrivateDto,
} from "../../contracts";
import {
  knowledgeMapGenerationSchema,
  practiceAttemptSubmissionSchema,
  practiceItemGenerationSchema,
  sourceAnchorSnapshotSchema,
  sourceLocatorSchema,
} from "../../validators";
import {
  goalRevisionCommandSchema,
  profileResetCommandSchema,
  regradeCommandSchema,
} from "../../server/input-schemas";
import { computeContentFingerprint } from "@/lib/files/content-fingerprint";
import { runLearningGoldenEvals } from "../index";
import { LEARNING_GOLDEN_CASES } from "../golden-fixtures";

/**
 * P1-E deterministic release gates. Every case runs without user data, without
 * a database, and without a real provider — CI executes this surface while
 * provider-backed evaluation runs only through the manual workflow script
 * (`scripts/evaluate-learning-release.ts --provider`).
 *
 * A candidate release is blocked when any gate that passed in the frozen
 * baseline now fails (see `compareReleaseGates`).
 */
export type ReleaseGateName =
  | "answer_leakage"
  | "authorization"
  | "source_integrity"
  | "projection"
  | "idempotency";

export type FailureStage =
  | "dto"
  | "validation"
  | "projection"
  | "contract";

export type ReleaseEnvironment = "ci" | "local" | "manual-provider";

export interface ReleaseGateCase {
  id: string;
  gate: ReleaseGateName;
  failureStage: FailureStage;
  /** Practice item type, study pack, goal, or contract scope being gated. */
  itemType: string;
  run: () => boolean | { passed: boolean; detail?: string };
}

export interface ReleaseGateResult {
  id: string;
  gate: ReleaseGateName;
  failureStage: FailureStage;
  itemType: string;
  passed: boolean;
  detail?: string;
}

export interface ReleaseRunManifest {
  runner: "learning-release-gates";
  version: "1";
  ranAt: string;
  environment: ReleaseEnvironment;
  model: string;
  anonymized: true;
  commitSha?: string;
}

export interface ReleaseGateReport {
  manifest: ReleaseRunManifest;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  byGate: Record<ReleaseGateName, { total: number; passed: number }>;
  byItemType: Record<string, { total: number; passed: number }>;
  byFailureStage: Record<string, { total: number; passed: number }>;
  results: readonly ReleaseGateResult[];
}

export interface ReleaseGateComparison {
  regressions: ReleaseGateResult[];
  improvements: ReleaseGateResult[];
  stable: number;
}

const privateItem: PracticeItemPrivateDto = {
  id: "item-1",
  lineageId: "lineage-1",
  version: 1,
  prompt: "2 + 2 = ?",
  type: "numeric",
  mode: "evidence_bearing",
  freshness: "current",
  sourceAnchors: [],
  answerCriteria: {
    kind: "numeric",
    expected: 4,
    absoluteTolerance: 0,
  },
  explanation: "2 与 2 相加得到 4。",
  generationMetadata: {
    provider: "fixture-provider",
    hiddenReasoning: "must-not-leak",
  },
};

const FAILED = (detail: string) => ({ passed: false, detail });

const RELEASE_GATE_CASES: readonly ReleaseGateCase[] = Object.freeze([
  // ============================================================
  // answer_leakage — nothing private leaves the server pre-submit.
  // ============================================================
  {
    id: "leakage-public-dto-hides-private-fields",
    gate: "answer_leakage",
    failureStage: "dto",
    itemType: "numeric",
    run: () => {
      const payload = toPublicPracticeItem(privateItem);
      if ("answerCriteria" in payload || "explanation" in payload || "generationMetadata" in payload) {
        return FAILED("public practice item must not carry answerCriteria/explanation/generationMetadata");
      }
      if (JSON.stringify(payload).includes("must-not-leak")) {
        return FAILED("public payload serialized hidden generation metadata");
      }
      return true;
    },
  },
  {
    id: "leakage-feedback-reveals-only-explanation",
    gate: "answer_leakage",
    failureStage: "dto",
    itemType: "numeric",
    run: () => {
      const payload = toPracticeItemFeedback(privateItem);
      if (payload.explanation !== privateItem.explanation) {
        return FAILED("post-submit feedback must reveal the explanation");
      }
      if ("answerCriteria" in payload || "generationMetadata" in payload) {
        return FAILED("feedback must not carry answerCriteria/generationMetadata");
      }
      return true;
    },
  },
  {
    id: "leakage-model-output-rejects-unknown-fields",
    gate: "answer_leakage",
    failureStage: "contract",
    itemType: "single_choice",
    run: () => {
      const result = practiceItemGenerationSchema.safeParse({
        stableKey: "kcl-q1",
        prompt: "节点电流是否守恒？",
        type: "single_choice",
        mode: "evidence_bearing",
        options: [
          { id: "opt-a", label: "守恒" },
          { id: "opt-b", label: "不守恒" },
        ],
        answerCriteria: {
          kind: "single_choice",
          selectedOptionId: "opt-a",
        },
        explanation: "依据基尔霍夫电流定律。",
        sourceHandles: ["handle-1"],
        knowledgePointStableKeys: ["kcl"],
        predecessorStableKeys: [],
        leakedAnswer: 4,
      });
      return result.success
        ? FAILED("model output with an unknown leaked field must be rejected")
        : true;
    },
  },
  // ============================================================
  // authorization — client-injected server-owned state is rejected.
  // ============================================================
  {
    id: "auth-attempt-submission-rejects-server-owned-fields",
    gate: "authorization",
    failureStage: "validation",
    itemType: "numeric",
    run: () => {
      const injections = [
        ["verdict", "correct"],
        ["score", 1],
        ["assistanceLevel", "independent"],
        ["spacingSeconds", 86_400],
      ] as const;
      const accepted = injections.filter(([field, value]) =>
        practiceAttemptSubmissionSchema.safeParse({
          idempotencyKey: "attempt-key",
          answer: 4,
          [field]: value,
        }).success
      );
      return accepted.length === 0
        ? true
        : FAILED(`client injected server-owned fields accepted: ${accepted.map(([field]) => field).join(", ")}`);
    },
  },
  {
    id: "auth-regrade-rejects-injected-ownership",
    gate: "authorization",
    failureStage: "validation",
    itemType: "attempt",
    run: () => {
      const result = regradeCommandSchema.safeParse({
        verdict: "correct",
        reason: "人工复核通过",
        idempotencyKey: "regrade-1",
        attemptId: "attempt-other-user",
      });
      return result.success
        ? FAILED("regrade command must not accept client-supplied attemptId")
        : true;
    },
  },
  {
    id: "auth-profile-reset-scope-is-strict",
    gate: "authorization",
    failureStage: "validation",
    itemType: "goal",
    run: () => {
      const userScopeWithGoal = profileResetCommandSchema.safeParse({
        scope: { kind: "user", goalId: "goal-1" },
        idempotencyKey: "reset-1",
      });
      if (userScopeWithGoal.success) {
        return FAILED("user-scoped reset must not carry a goalId");
      }
      const pointScope = profileResetCommandSchema.safeParse({
        scope: { kind: "point", goalId: "goal-1", lineageId: "lineage-1" },
        idempotencyKey: "reset-2",
      });
      return pointScope.success ? true : FAILED("valid point-scoped reset rejected");
    },
  },
  // ============================================================
  // source_integrity — locators, fingerprints, and anchors stay server-owned.
  // ============================================================
  {
    id: "source-locator-v2-accepts-precise-positions",
    gate: "source_integrity",
    failureStage: "contract",
    itemType: "knowledge_map",
    run: () => {
      const valid = [
        { kind: "file" },
        { kind: "page", page: 3, paragraph: 2 },
        { kind: "block", blockId: "blk-1", pageNumber: 5 },
        { kind: "range", start: 0, end: 120 },
      ];
      const rejected = valid.filter((locator) => !sourceLocatorSchema.safeParse(locator).success);
      if (rejected.length > 0) {
        return FAILED(`valid locator v2 rejected: ${JSON.stringify(rejected)}`);
      }
      const unknown = sourceLocatorSchema.safeParse({ kind: "paragraph", index: 2 });
      if (unknown.success) {
        return FAILED("unknown locator kind must be rejected");
      }
      const missingBlockId = sourceLocatorSchema.safeParse({ kind: "block", pageNumber: 5 });
      if (missingBlockId.success) {
        return FAILED("block locator without blockId must be rejected");
      }
      return true;
    },
  },
  {
    id: "source-fingerprint-is-deterministic-and-prefixed",
    gate: "source_integrity",
    failureStage: "contract",
    itemType: "knowledge_map",
    run: () => {
      const content = "基尔霍夫电流定律：流入节点的电流等于流出节点的电流。";
      const first = computeContentFingerprint(content);
      const second = computeContentFingerprint(content);
      if (first !== second) {
        return FAILED("content fingerprint must be deterministic");
      }
      if (!first.startsWith("sha256:v1:")) {
        return FAILED("content fingerprint must carry the server-owned sha256:v1 prefix");
      }
      if (computeContentFingerprint(` ${content} `) !== first) {
        return FAILED("fingerprint must normalize surrounding whitespace");
      }
      return true;
    },
  },
  {
    id: "source-model-cannot-forge-fingerprints-or-hashes",
    gate: "source_integrity",
    failureStage: "contract",
    itemType: "knowledge_map",
    run: () => {
      const result = knowledgeMapGenerationSchema.safeParse({
        points: [
          {
            stableKey: "ohms-law",
            name: "欧姆定律",
            kind: "concept",
            order: 0,
            predecessorStableKeys: [],
            sourceHandles: ["server-handle-1"],
            contentFingerprint: "model-forged-fingerprint",
            excerptHash: "model-forged-hash",
          },
        ],
      });
      return result.success
        ? FAILED("model output must not be allowed to forge fingerprints or hashes")
        : true;
    },
  },
  {
    id: "source-anchor-snapshot-accepts-block-locators",
    gate: "source_integrity",
    failureStage: "contract",
    itemType: "knowledge_map",
    run: () => {
      const snapshot = sourceAnchorSnapshotSchema.safeParse({
        projectId: "project-1",
        anchorKey: "sha256:anchor-1",
        fileAssetId: "file-1",
        sourceFileName: "电路原理.md",
        documentChunkId: "chunk-9",
        locator: { kind: "block", blockId: "blk-1", pageNumber: 5 },
        contentFingerprint: "sha256:v1:abcdef123456",
        excerptHash: "sha256:excerpt-1",
      });
      return snapshot.success ? true : FAILED("valid block-level anchor snapshot rejected");
    },
  },
  // ============================================================
  // projection — golden policy baseline stays green (P0 + P1 regrade/fork).
  // ============================================================
  {
    id: "projection-golden-policy-baseline",
    gate: "projection",
    failureStage: "projection",
    itemType: "policy",
    run: () => {
      const report = runLearningGoldenEvals(LEARNING_GOLDEN_CASES);
      if (report.failed > 0) {
        const failures = report.results
          .filter((result) => !result.passed)
          .map((result) => `${result.id}: ${result.failures.join("; ")}`)
          .join("\n");
        return FAILED(`${report.failed}/${report.total} golden cases failed:\n${failures}`);
      }
      return true;
    },
  },
  // ============================================================
  // idempotency — every write command carries a mandatory idempotency key.
  // ============================================================
  {
    id: "idempotency-attempt-submission-requires-key",
    gate: "idempotency",
    failureStage: "validation",
    itemType: "attempt",
    run: () => {
      const result = practiceAttemptSubmissionSchema.safeParse({ answer: 4 });
      return result.success
        ? FAILED("attempt submission without idempotencyKey must be rejected")
        : true;
    },
  },
  {
    id: "idempotency-regrade-requires-key",
    gate: "idempotency",
    failureStage: "validation",
    itemType: "attempt",
    run: () => {
      const result = regradeCommandSchema.safeParse({
        verdict: "correct",
        reason: "人工复核通过",
      });
      return result.success
        ? FAILED("regrade command without idempotencyKey must be rejected")
        : true;
    },
  },
  {
    id: "idempotency-profile-reset-requires-key",
    gate: "idempotency",
    failureStage: "validation",
    itemType: "goal",
    run: () => {
      const result = profileResetCommandSchema.safeParse({
        scope: { kind: "point", goalId: "goal-1", lineageId: "lineage-1" },
      });
      return result.success
        ? FAILED("profile reset without idempotencyKey must be rejected")
        : true;
    },
  },
  {
    id: "idempotency-goal-revision-requires-key",
    gate: "idempotency",
    failureStage: "validation",
    itemType: "goal",
    run: () => {
      const result = goalRevisionCommandSchema.safeParse({
        title: "修订后的目标",
        reason: "范围调整",
      });
      return result.success
        ? FAILED("goal revision without idempotencyKey must be rejected")
        : true;
    },
  },
]);

function normalizeResult(caseResult: boolean | { passed: boolean; detail?: string }) {
  if (typeof caseResult === "boolean") {
    return { passed: caseResult, detail: caseResult ? undefined : "gate failed" };
  }
  return caseResult;
}

export function runLearningReleaseGates(options: {
  environment?: ReleaseEnvironment;
  model?: string;
  commitSha?: string;
  ranAt?: string;
} = {}): ReleaseGateReport {
  const results = RELEASE_GATE_CASES.map((testCase) => {
    let outcome: { passed: boolean; detail?: string };
    try {
      outcome = normalizeResult(testCase.run());
    } catch (error) {
      outcome = {
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    return Object.freeze({
      id: testCase.id,
      gate: testCase.gate,
      failureStage: testCase.failureStage,
      itemType: testCase.itemType,
      passed: outcome.passed,
      detail: outcome.detail,
    } satisfies ReleaseGateResult);
  });

  const byGate = {} as Record<ReleaseGateName, { total: number; passed: number }>;
  const byItemType = {} as Record<string, { total: number; passed: number }>;
  const byFailureStage = {} as Record<string, { total: number; passed: number }>;
  for (const result of results) {
    byGate[result.gate] = byGate[result.gate] ?? { total: 0, passed: 0 };
    byGate[result.gate].total += 1;
    byGate[result.gate].passed += result.passed ? 1 : 0;
    byItemType[result.itemType] = byItemType[result.itemType] ?? { total: 0, passed: 0 };
    byItemType[result.itemType].total += 1;
    byItemType[result.itemType].passed += result.passed ? 1 : 0;
    byFailureStage[result.failureStage] =
      byFailureStage[result.failureStage] ?? { total: 0, passed: 0 };
    byFailureStage[result.failureStage].total += 1;
    byFailureStage[result.failureStage].passed += result.passed ? 1 : 0;
  }

  const passed = results.filter((result) => result.passed).length;
  return Object.freeze({
    manifest: Object.freeze({
      runner: "learning-release-gates",
      version: "1",
      ranAt: options.ranAt ?? new Date().toISOString(),
      environment: options.environment ?? "local",
      model: options.model ?? "deterministic",
      anonymized: true,
      ...(options.commitSha ? { commitSha: options.commitSha } : {}),
    } satisfies ReleaseRunManifest),
    summary: { total: results.length, passed, failed: results.length - passed },
    byGate,
    byItemType,
    byFailureStage,
    results: Object.freeze(results),
  } satisfies ReleaseGateReport);
}

/**
 * Compares a candidate report against a frozen baseline by case id. Any case
 * that passed in the baseline but fails in the candidate blocks the release.
 */
export function compareReleaseGates(
  baseline: ReleaseGateReport,
  candidate: ReleaseGateReport,
): ReleaseGateComparison {
  const baselineById = new Map(
    baseline.results.map((result) => [result.id, result.passed]),
  );
  const regressions: ReleaseGateResult[] = [];
  const improvements: ReleaseGateResult[] = [];
  let stable = 0;
  for (const candidateResult of candidate.results) {
    const baselinePassed = baselineById.get(candidateResult.id);
    if (baselinePassed === undefined) {
      // New case: it must pass on arrival; a failing new case is a regression
      // for the candidate that introduced it.
      if (!candidateResult.passed) regressions.push(candidateResult);
      else stable += 1;
      continue;
    }
    if (baselinePassed && !candidateResult.passed) {
      regressions.push(candidateResult);
    } else if (!baselinePassed && candidateResult.passed) {
      improvements.push(candidateResult);
    } else {
      stable += 1;
    }
  }
  return Object.freeze({ regressions, improvements, stable });
}

export const RELEASE_GATE_CASE_COUNT = RELEASE_GATE_CASES.length;
export const RELEASE_GATE_NAMES = Object.freeze(
  RELEASE_GATE_CASES.reduce<Partial<Record<ReleaseGateName, number>>>(
    (acc, testCase) => {
      acc[testCase.gate] = (acc[testCase.gate] ?? 0) + 1;
      return acc;
    },
    {},
  ),
);
