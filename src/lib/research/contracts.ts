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
  | "research.evaluator"
  | "research.synthesizer"
  | "research.verifier";

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
}

export interface ResearchQuestionPlan {
  key: string;
  title: string;
  question: string;
  priority: ResearchPriority;
  completionCriteria: string[];
  sourceStrategy: string[];
}

export interface ResearchPlanSnapshot {
  schemaVersion: "1";
  researchGoal: string;
  scope: string;
  timeRange: string | null;
  researchQuestions: ResearchQuestionPlan[];
  sourceStrategy: string[];
  completionCriteria: string[];
  expectedOutputs: string[];
  researchIntensity: ResearchBudgetProfile;
  domainProfileKey: string;
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
