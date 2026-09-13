export const RESEARCH_RUN_STATUSES = [
  "planning",
  "awaiting_confirmation",
  "queued",
  "researching",
  "evaluating",
  "synthesizing",
  "verifying",
  "completed",
  "cancelled",
  "failed",
  "awaiting_scope_confirmation",
] as const;

export type ResearchRunStatus = (typeof RESEARCH_RUN_STATUSES)[number];

/**
 * 用户可见的研究阶段。run.status 是有状态的粗粒度枚举（citation expansion /
 * claim extraction / visual evidence 都在 evaluating 之下运行），因此 UI 需要
 * 一个额外的、由 durable checkpoint 派生的细分阶段，避免把多个后台阶段显示成
 * 一个模糊的永久「处理中」。
 */
export const RESEARCH_STAGE_KEYS = [
  "planning",
  "awaiting_confirmation",
  "queued",
  "awaiting_scope_confirmation",
  "researching",
  "evaluating",
  "citation_expansion",
  "visual_evidence",
  "claim_extraction",
  "synthesizing",
  "verifying",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ResearchStageKey = (typeof RESEARCH_STAGE_KEYS)[number];

export const RESEARCH_BUDGET_PROFILES = ["quick", "deep", "comprehensive"] as const;
export type ResearchBudgetProfile = (typeof RESEARCH_BUDGET_PROFILES)[number];

export const RESEARCH_PRIORITIES = ["critical", "important", "supporting"] as const;
export type ResearchPriority = (typeof RESEARCH_PRIORITIES)[number];

export const RESEARCH_QUESTION_STATUSES = [
  "pending",
  "researching",
  "evaluating",
  "resolved",
  "partially_resolved",
  "unresolved",
  "controversial",
] as const;
export type ResearchQuestionStatus = (typeof RESEARCH_QUESTION_STATUSES)[number];

export type ResearchRole =
  | "research.planner"
  | "research.worker"
  | "research.source_triage"
  | "research.evaluator"
  | "research.claim_extractor"
  | "research.visual_evaluator"
  | "research.report_architect"
  | "research.synthesizer"
  | "research.verifier"
  | "research.report_auditor";

export interface ResearchBudgetLimits {
  profile: ResearchBudgetProfile;
  wallTimeMs: number;
  modelCalls: number;
  searchCalls: number;
  fetchCalls: number;
  maxSources: number;
  maxTokens: number;
  maxCostCredits: number;
  researcherConcurrency: number;
  maxReplans: number;
  maxVerificationRepairs: number;
  maxQuestionResearchAttempts: number;
  maxQuestionEvaluateAttempts: number;
  maxQuestionReplans: number;
}

export interface ResearchFinalizationBudgetReserve {
  modelCalls: number;
  maxTokens: number;
  maxCostCredits: number;
}

export const RESEARCH_INTENT_TYPES = [
  "factual",
  "comparison",
  "trend",
  "literature_review",
  "causal",
  "recommendation",
  "technical_review",
] as const;
export type ResearchIntentType = (typeof RESEARCH_INTENT_TYPES)[number];

export interface ResearchQuestionPlan {
  key: string;
  title: string;
  question: string;
  priority: ResearchPriority;
  completionCriteria: string[];
  sourceStrategy: string[];
}

export interface ResearchPlanSnapshot {
  schemaVersion: "1" | "2";
  /** 用户原始输入。Planner 可以重组研究问题，但不得改写这一字段。 */
  originalRequest?: string;
  objective?: string;
  intentType?: ResearchIntentType;
  targetTimeRange?: string | null;
  evidenceTimeRange?: string | null;
  scopeInclusions?: string[];
  scopeExclusions?: string[];
  assumptions?: string[];
  evaluationDimensions?: string[];
  expectedOutput?: string;
  researchGoal: string;
  scope: string;
  timeRange: string | null;
  researchQuestions: ResearchQuestionPlan[];
  sourceStrategy: string[];
  completionCriteria: string[];
  expectedOutputs: string[];
  researchIntensity: ResearchBudgetProfile;
  domainProfileKey: string;
  domainProfile?: {
    name: string;
    sourcePriorities: string[];
    evidenceStandards: string[];
    citationRules: string[];
    outputStructure: string[];
    preferredProviders: string[];
  };
}

export interface ResearchStopInput {
  limits: ResearchBudgetLimits;
  modelCalls: number;
  totalTokens?: number;
  costCredits?: number;
  searchCalls: number;
  fetchCalls: number;
  sourceCount: number;
  elapsedMs: number;
  criticalQuestionsResolved: boolean;
  semanticCoverage: number;
  sourceDiversity: number;
  independentCorroboration: number;
  conflictCoverage: number;
  informationGain: number;
  hasPendingCriticalWork: boolean;
}

export interface ResearchStopDecision {
  stop: boolean;
  reason:
    | "hard_budget"
    | "semantic_coverage"
    | "no_information_gain"
    | "critical_work_pending"
    | "continue";
  summary: string;
}

export type ResearchQualityLabel = "证据充分" | "中等" | "有限" | "存在争议";

export interface ResearchPublicEvent {
  kind:
    | "plan_created"
    | "plan_confirmed"
    | "stage_changed"
    | "task_started"
    | "task_completed"
    | "source_candidate_discovered"
    | "source_snapshot_created"
    | "evidence_extracted"
    | "question_evaluated"
    | "budget_updated"
    | "verification_updated"
    | "report_completed"
    | "scope_confirmation_required";
  runId: string;
  message: string;
  publicData?: Record<string, unknown>;
  createdAt: string;
}
