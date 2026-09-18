import { prisma } from "@/lib/db";
import { runAgentRuntime } from "@/lib/agent/runtime";
import type { AgentModel, AgentUsage } from "@/lib/agent/contracts";
import type { ServerFileAttachment } from "@/lib/chat/router";
import { logger } from "@/lib/logger";
import { RESEARCH_INTENT_TYPES, type ResearchIntentType, type ResearchPriority, type ResearchRole } from "./contracts";
import { selectResearchModel } from "./model-routing";
import type { ChatModel } from "@/lib/chat/model-catalog";

export interface ResearchModelStageInput {
  role: ResearchRole;
  userId: string;
  conversationId: string;
  projectId: string | null;
  signal: AbortSignal;
  prompt: string;
  /** Per-run 指挥模型：非空时优先于 env 覆盖与默认路由。 */
  modelOverride?: ChatModel | null;
  parse?: (content: string) => unknown;
  /**
   * 显式选中的多模态附件（视觉证据阶段专用）。只有调用方明确传入的字节会被
   * 附带；Research 阶段不会触发通用 Project 媒体自动匹配。默认空数组。
   */
  attachments?: ServerFileAttachment[];
}

export interface ResearchModelStageResult<T> {
  value: T | null;
  model: AgentModel;
  usage: AgentUsage | null;
  attempted: boolean;
}

/**
 * Runs a bounded, non-networking structured stage through the existing Agent
 * Runtime. The response is intentionally read from the persisted assistant
 * message; reasoning and tool events never cross this domain boundary.
 */
export async function runResearchModelStage<T>(input: ResearchModelStageInput): Promise<ResearchModelStageResult<T>> {
  const selection = selectResearchModel(input.role, input.modelOverride);
  let attempted = false;
  try {
    attempted = true;
    const run = await runAgentRuntime({
      user: { id: input.userId },
      // Structured Research stages receive their bounded Evidence in the prompt.
      // Do not enable generic project context here: task 05 may otherwise attach
      // unselected project images merely because their names match the stage prompt.
      conversation: { id: input.conversationId },
      prompt: { message: input.prompt, attachments: input.attachments ?? [] },
      model: { requestedModel: selection.model, thinkingEnabled: false, reasoningEffort: selection.reasoningEffort },
      capabilities: { webSearchActive: false, skillOff: true, selectedFileIds: [], isQuickTask: false, mode: "general" },
      signal: input.signal,
    });
    for await (const event of run.events) {
      if (event.type === "completed") break;
    }
    const completion = await run.completion;
    if (completion.status !== "completed") return { value: null, model: selection.model, usage: completion.usage, attempted };
    const message = await prisma.message.findUnique({ where: { id: completion.messageId }, select: { content: true } });
    return {
      value: (input.parse ? input.parse(message?.content ?? "") : parseStructuredJson<T>(message?.content ?? "")) as T | null,
      model: selection.model,
      usage: completion.usage,
      attempted,
    };
  } catch (error) {
    logger.warn("Research model stage unavailable", {
      role: input.role,
      model: selection.model,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : typeof error,
      errorCause: error instanceof Error && error.cause ? (error.cause instanceof Error ? error.cause.message : String(error.cause)) : undefined,
    });
    return { value: null, model: selection.model, usage: null, attempted };
  }
}

export function parseStructuredJson<T>(content: string): T | null {
  const normalized = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  if (!normalized) return null;
  const candidates = [normalized];
  const firstObject = normalized.indexOf("{");
  const lastObject = normalized.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) candidates.push(normalized.slice(firstObject, lastObject + 1));
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      return parsed as T;
    } catch {
      // Try the next bounded candidate; never expose raw model text as a stage result.
    }
  }
  return null;
}

export interface ResearchWorkerDecision {
  queries: ResearchQueryStrategyItem[];
  rationale?: string;
}

export type ResearchQueryPurpose = "primary_work" | "survey" | "comparison" | "contradiction" | "baseline" | "recent_validation";
export type ResearchSourceRole = "primary" | "secondary" | "context";

export interface ResearchQueryStrategyItem {
  query: string;
  purpose: ResearchQueryPurpose;
  sourceRole: ResearchSourceRole;
  freshness: "target_period" | "retrospective_allowed" | "any";
  questionKey: string;
}

export interface ResearchPlannerDecision {
  objective?: string;
  intentType?: ResearchIntentType;
  targetTimeRange?: string | null;
  evidenceTimeRange?: string | null;
  scopeInclusions?: string[];
  scopeExclusions?: string[];
  assumptions?: string[];
  evaluationDimensions?: string[];
  expectedOutput?: string;
  scope?: string;
  timeRange?: string | null;
  sourceStrategy?: string[];
  completionCriteria?: string[];
  expectedOutputs?: string[];
  questions?: Array<{
    key: string;
    title?: string;
    question?: string;
    priority?: ResearchPriority;
    completionCriteria?: string[];
    sourceStrategy?: string[];
  }>;
}

function boundedStrings(value: unknown, maximum: number, itemMaximum: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, itemMaximum))
    .slice(0, maximum);
  return result.length > 0 ? result : undefined;
}

export function normalizeResearchPlannerDecision(value: unknown): ResearchPlannerDecision {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const questions = Array.isArray(record.questions)
    ? record.questions.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const question = item as Record<string, unknown>;
        if (typeof question.key !== "string" || !/^q[1-8]$/.test(question.key)) return [];
        return [{
          key: question.key,
          title: typeof question.title === "string" ? question.title.trim().slice(0, 120) : undefined,
          question: typeof question.question === "string" ? question.question.trim().slice(0, 2_000) : undefined,
          priority: question.priority === "critical" || question.priority === "important" || question.priority === "supporting" ? question.priority as ResearchPriority : undefined,
          completionCriteria: boundedStrings(question.completionCriteria, 6, 240),
          sourceStrategy: boundedStrings(question.sourceStrategy, 6, 240),
        }];
      }).slice(0, 8)
    : undefined;
  return {
    objective: typeof record.objective === "string" ? record.objective.trim().slice(0, 2_000) : undefined,
    intentType: typeof record.intentType === "string" && (RESEARCH_INTENT_TYPES as readonly string[]).includes(record.intentType) ? record.intentType as ResearchIntentType : undefined,
    targetTimeRange: record.targetTimeRange === null ? null : typeof record.targetTimeRange === "string" ? record.targetTimeRange.trim().slice(0, 240) : undefined,
    evidenceTimeRange: record.evidenceTimeRange === null ? null : typeof record.evidenceTimeRange === "string" ? record.evidenceTimeRange.trim().slice(0, 240) : undefined,
    scopeInclusions: boundedStrings(record.scopeInclusions, 8, 240),
    scopeExclusions: boundedStrings(record.scopeExclusions, 8, 240),
    assumptions: boundedStrings(record.assumptions, 8, 240),
    evaluationDimensions: boundedStrings(record.evaluationDimensions, 8, 120),
    expectedOutput: typeof record.expectedOutput === "string" ? record.expectedOutput.trim().slice(0, 1_000) : undefined,
    scope: typeof record.scope === "string" ? record.scope.trim().slice(0, 2_000) : undefined,
    timeRange: record.timeRange === null ? null : typeof record.timeRange === "string" ? record.timeRange.trim().slice(0, 240) : undefined,
    sourceStrategy: boundedStrings(record.sourceStrategy, 8, 240),
    completionCriteria: boundedStrings(record.completionCriteria, 8, 240),
    expectedOutputs: boundedStrings(record.expectedOutputs, 8, 240),
    questions,
  };
}

const QUERY_PURPOSES = new Set<ResearchQueryPurpose>(["primary_work", "survey", "comparison", "contradiction", "baseline", "recent_validation"]);
const SOURCE_ROLES = new Set<ResearchSourceRole>(["primary", "secondary", "context"]);

export function normalizeResearchWorkerDecision(value: unknown, fallback: string, questionKey = "q1"): ResearchWorkerDecision {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const queries = Array.isArray(record.queries)
    ? record.queries.flatMap((item, index) => {
        if (typeof item === "string" && item.trim()) {
          return [{ query: item.trim().slice(0, 500), purpose: index === 0 ? "primary_work" as const : "comparison" as const, sourceRole: index === 0 ? "primary" as const : "secondary" as const, freshness: "any" as const, questionKey }];
        }
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const query = item as Record<string, unknown>;
        if (typeof query.query !== "string" || !query.query.trim()) return [];
        const purpose = QUERY_PURPOSES.has(query.purpose as ResearchQueryPurpose) ? query.purpose as ResearchQueryPurpose : "primary_work";
        const sourceRole = SOURCE_ROLES.has(query.sourceRole as ResearchSourceRole) ? query.sourceRole as ResearchSourceRole : purpose === "survey" ? "secondary" : "primary";
        const freshness: ResearchQueryStrategyItem["freshness"] = query.freshness === "target_period" || query.freshness === "retrospective_allowed" || query.freshness === "any" ? query.freshness : "any";
        return [{ query: query.query.trim().slice(0, 500), purpose, sourceRole, freshness, questionKey: typeof query.questionKey === "string" && /^q[1-8]$/.test(query.questionKey) ? query.questionKey : questionKey }];
      }).slice(0, 4)
    : [];
  return {
    queries: queries.length > 0 ? queries : [{ query: fallback, purpose: "primary_work", sourceRole: "primary", freshness: "any", questionKey }],
    rationale: typeof record.rationale === "string" ? record.rationale.slice(0, 1_000) : undefined,
  };
}

export type ResearchEvaluationStatus = "resolved" | "partially_resolved" | "unresolved" | "controversial";

export interface ResearchEvaluatorDecision {
  status: ResearchEvaluationStatus;
  coverage: number;
  directness: number;
  gap?: string;
  followUpQueries?: string[];
  criterionCoverage?: Array<{ criterion: string; covered: boolean; evidenceIds: string[]; reason?: string }>;
  independentSourceCount?: number;
  primaryEvidencePresent?: boolean;
  conflictState?: "none" | "possible" | "confirmed";
  stopReason?: string;
}

export function normalizeResearchEvaluatorDecision(value: unknown, fallback: ResearchEvaluatorDecision): ResearchEvaluatorDecision {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const status = record.status === "resolved" || record.status === "partially_resolved" || record.status === "unresolved" || record.status === "controversial" ? record.status : fallback.status;
  const numberOr = (candidate: unknown, defaultValue: number) => typeof candidate === "number" && Number.isFinite(candidate) ? Math.max(0, Math.min(1, candidate)) : defaultValue;
  const followUpQueries = Array.isArray(record.followUpQueries)
    ? record.followUpQueries.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 3)
    : fallback.followUpQueries;
  return {
    status,
    coverage: numberOr(record.coverage, fallback.coverage),
    directness: numberOr(record.directness, fallback.directness),
    gap: typeof record.gap === "string" ? record.gap.slice(0, 2_000) : fallback.gap,
    followUpQueries,
    criterionCoverage: Array.isArray(record.criterionCoverage) ? record.criterionCoverage.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const entry = item as Record<string, unknown>;
      if (typeof entry.criterion !== "string") return [];
      return [{ criterion: entry.criterion.slice(0, 240), covered: entry.covered === true, evidenceIds: boundedStrings(entry.evidenceIds, 12, 120) ?? [], reason: typeof entry.reason === "string" ? entry.reason.slice(0, 500) : undefined }];
    }).slice(0, 12) : fallback.criterionCoverage,
    independentSourceCount: typeof record.independentSourceCount === "number" && Number.isFinite(record.independentSourceCount) ? Math.max(0, Math.floor(record.independentSourceCount)) : fallback.independentSourceCount,
    primaryEvidencePresent: typeof record.primaryEvidencePresent === "boolean" ? record.primaryEvidencePresent : fallback.primaryEvidencePresent,
    conflictState: record.conflictState === "none" || record.conflictState === "possible" || record.conflictState === "confirmed" ? record.conflictState : fallback.conflictState,
    stopReason: typeof record.stopReason === "string" ? record.stopReason.slice(0, 500) : fallback.stopReason,
  };
}

export type ResearchVerificationStatus = "verified" | "needs_qualification" | "unsupported" | "conflicted";

/**
 * 规范化后的稳定 reasonCode 集合。模型返回的未知 reason 一律归入 model_review，
 * 不直接进入持久业务逻辑；deterministic 下界使用的 reasonCode 也属于本集合。
 */
export const RESEARCH_VERIFIER_REASON_CODES = [
  "sufficient_support",
  "single_source_only",
  "indirect_support",
  "scope_mismatch",
  "temporal_mismatch",
  "mixed_evidence",
  "contradicted",
  "no_support",
  "invalid_evidence",
  "model_review",
] as const;

export type ResearchVerifierReasonCode = (typeof RESEARCH_VERIFIER_REASON_CODES)[number];

export function normalizeVerifierReasonCode(value: unknown): ResearchVerifierReasonCode {
  return typeof value === "string" && (RESEARCH_VERIFIER_REASON_CODES as readonly string[]).includes(value)
    ? value as ResearchVerifierReasonCode
    : "model_review";
}

export interface ResearchVerifierDecision {
  claims: Record<string, { status: ResearchVerificationStatus; reasonCode: ResearchVerifierReasonCode }>;
}

export function normalizeResearchVerifierDecision(value: unknown): ResearchVerifierDecision {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const claims: ResearchVerifierDecision["claims"] = {};
  const rawClaims = record.claims && typeof record.claims === "object" && !Array.isArray(record.claims) ? record.claims as Record<string, unknown> : {};
  for (const [claimId, raw] of Object.entries(rawClaims)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const status = item.status === "verified" || item.status === "needs_qualification" || item.status === "unsupported" || item.status === "conflicted" ? item.status : null;
    if (!status) continue;
    claims[claimId] = { status, reasonCode: normalizeVerifierReasonCode(item.reasonCode) };
  }
  return { claims };
}
