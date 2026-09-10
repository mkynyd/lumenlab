import type { ResearchRunStatus, ResearchStageKey } from "./contracts";

const TERMINAL = new Set<ResearchRunStatus>(["completed", "cancelled", "failed"]);

const ALLOWED: Record<ResearchRunStatus, readonly ResearchRunStatus[]> = {
  planning: ["awaiting_confirmation", "cancelled", "failed"],
  awaiting_confirmation: ["queued", "planning", "cancelled", "failed"],
  queued: ["researching", "cancelled", "failed"],
  researching: ["evaluating", "awaiting_scope_confirmation", "cancelled", "failed"],
  evaluating: ["researching", "synthesizing", "awaiting_scope_confirmation", "cancelled", "failed"],
  synthesizing: ["verifying", "awaiting_scope_confirmation", "cancelled", "failed"],
  verifying: ["completed", "researching", "evaluating", "synthesizing", "awaiting_scope_confirmation", "cancelled", "failed"],
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

const RESEARCH_STAGE_LABELS: Record<ResearchStageKey, string> = {
  planning: "生成研究计划",
  awaiting_confirmation: "等待确认计划",
  queued: "排队中",
  awaiting_scope_confirmation: "等待确认扩大范围",
  researching: "检索并阅读来源",
  evaluating: "评估证据缺口",
  citation_expansion: "沿引用关系扩展来源",
  visual_evidence: "分析论文图表",
  claim_extraction: "提炼并核验命题",
  synthesizing: "整理报告",
  verifying: "核验引用",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};

export interface ResearchPublicStage {
  key: ResearchStageKey;
  label: string;
}

function isStageKey(value: string): value is ResearchStageKey {
  return value in RESEARCH_STAGE_LABELS;
}

/**
 * 合并 run.status 与 durable checkpoint stage，得到用户可见的细分阶段。
 * 终态与需要用户动作的状态以 run.status 为准；执行中的状态用 checkpoint stage
 * 细化（citation expansion / visual evidence / claim extraction 都在 evaluating 之下）。
 */
export function resolveResearchPublicStage(
  status: ResearchRunStatus,
  checkpointStage?: string | null,
): ResearchPublicStage {
  const terminalOrBlocking: ResearchStageKey[] = ["completed", "failed", "cancelled", "planning", "awaiting_confirmation", "awaiting_scope_confirmation", "queued"];
  if ((terminalOrBlocking as string[]).includes(status)) {
    const key = status as ResearchStageKey;
    return { key, label: RESEARCH_STAGE_LABELS[key] };
  }
  if (checkpointStage && isStageKey(checkpointStage) && checkpointStage !== "planning") {
    return { key: checkpointStage, label: RESEARCH_STAGE_LABELS[checkpointStage] };
  }
  const fallback = status as ResearchStageKey;
  return { key: fallback, label: RESEARCH_STAGE_LABELS[fallback] ?? publicStageLabel(status) };
}

/**
 * provider 降级的稳定代码 → 用户可读文案。未知代码不猜测，直接不展示。
 */
export const RESEARCH_DEGRADATION_MESSAGES: Record<string, string> = {
  sciverse_error: "学术检索（Sciverse）暂时不可用，已改用其它学术来源继续",
  sciverse_empty: "学术检索（Sciverse）本轮没有返回结果，已改用其它学术来源继续",
  sciverse_catalog_unavailable: "学术检索的字段目录暂时不可用，已退回基础检索条件",
  sciverse_filters_dropped: "部分高级检索条件当前不受支持，已自动收敛后继续",
  arxiv_error: "arXiv 暂时不可用，已使用其它学术来源继续",
  web_error: "联网搜索暂时不可用，已使用学术与项目来源继续",
  visual_resources_unavailable: "论文图表资源暂时不可读，已仅使用正文证据继续",
  visual_model_unavailable: "图表分析模型暂时不可用，已仅使用正文证据继续",
};

export function describeResearchDegradation(code: string): string | null {
  return RESEARCH_DEGRADATION_MESSAGES[code] ?? null;
}
