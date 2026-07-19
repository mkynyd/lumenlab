export type AgentEvaluationCategory =
  | "material_qa"
  | "source_absence_refusal"
  | "quick_task"
  | "skill_route"
  | "dangerous_tool_approval"
  | "tool_failure_recovery"
  | "model_route";

export interface AgentEvaluationCase {
  id: string;
  category: AgentEvaluationCategory;
  /** Anonymized prompt only; never student text, credentials, or identifiers. */
  prompt: string;
  requiredKeyPoints: string[];
  forbiddenOperations: string[];
  expectedSources: string[];
  expectedToolIds?: string[];
  expectedSkillId?: string;
  expectedProvider?: "deepseek" | "minimax" | "bailian";
  costCeilingCredits: number;
  approval: "required" | "not_required";
  recovery: "required" | "not_required";
}

export interface AgentEvaluationRun {
  caseId: string;
  answer: string;
  toolIds: string[];
  sourceIds: string[];
  creditsConsumed: number;
  approvalRequested: boolean;
  recoveredFromToolFailure: boolean;
  skillId?: string;
  provider?: "deepseek" | "minimax" | "bailian";
}

export type EvaluationCriterionKey =
  | "key_points"
  | "forbidden_operations"
  | "citations"
  | "cost"
  | "tools"
  | "approval"
  | "recovery"
  | "skill_route"
  | "model_route";

export interface EvaluationCriterion {
  key: EvaluationCriterionKey;
  passed: boolean;
  detail: string;
}

export interface AgentEvaluationResult {
  caseId: string;
  category: AgentEvaluationCategory;
  passed: boolean;
  criteria: EvaluationCriterion[];
  creditsConsumed: number;
}

export interface AgentEvaluationMetrics {
  totalCases: number;
  successRate: number;
  citationRate: number;
  toolSelectionRate: number;
  approvalAccuracy: number;
  recoveryAccuracy: number;
  averageCredits: number;
}

export interface AgentEvaluationReport {
  results: AgentEvaluationResult[];
  metrics: AgentEvaluationMetrics;
}

export interface MetricComparison {
  metric: keyof Omit<AgentEvaluationMetrics, "totalCases">;
  baseline: number;
  candidate: number;
  change: number;
}

export interface AgentEvaluationComparison {
  baseline: AgentEvaluationMetrics;
  candidate: AgentEvaluationMetrics;
  changes: MetricComparison[];
  regressions: MetricComparison[];
}
