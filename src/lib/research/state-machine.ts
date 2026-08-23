import type { ResearchRunStatus } from "./contracts";

const TERMINAL = new Set<ResearchRunStatus>(["completed", "cancelled", "failed"]);

const ALLOWED: Record<ResearchRunStatus, readonly ResearchRunStatus[]> = {
  planning: ["awaiting_confirmation", "cancelled", "failed"],
  awaiting_confirmation: ["queued", "planning", "cancelled", "failed"],
  queued: ["researching", "cancelled", "failed"],
  researching: ["evaluating", "awaiting_scope_confirmation", "cancelled", "failed"],
  evaluating: ["researching", "synthesizing", "awaiting_scope_confirmation", "cancelled", "failed"],
  synthesizing: ["verifying", "awaiting_scope_confirmation", "cancelled", "failed"],
  verifying: ["completed", "evaluating", "synthesizing", "awaiting_scope_confirmation", "cancelled", "failed"],
  awaiting_scope_confirmation: ["queued", "researching", "cancelled", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
};

export function canTransitionResearchRun(
  from: ResearchRunStatus,
  to: ResearchRunStatus
): boolean {
  return ALLOWED[from].includes(to);
}

export function assertResearchRunTransition(
  from: ResearchRunStatus,
  to: ResearchRunStatus
): void {
  if (!canTransitionResearchRun(from, to)) {
    throw new Error(`Research Run 状态不能从 ${from} 转为 ${to}`);
  }
}

export function isTerminalResearchRunStatus(status: ResearchRunStatus): boolean {
  return TERMINAL.has(status);
}

export function publicStageLabel(status: ResearchRunStatus): string {
  const labels: Record<ResearchRunStatus, string> = {
    planning: "规划中",
    awaiting_confirmation: "等待确认计划",
    queued: "排队中",
    researching: "研究中",
    evaluating: "评估中",
    synthesizing: "整理报告",
    verifying: "核验引用",
    completed: "已完成",
    cancelled: "已取消",
    failed: "执行失败",
    awaiting_scope_confirmation: "等待确认扩大范围",
  };
  return labels[status];
}
