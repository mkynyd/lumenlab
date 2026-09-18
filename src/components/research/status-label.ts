/**
 * 研究状态 → 学生可读中文标签的统一映射。
 *
 * ResearchRun / Evidence / EvidenceType 的持久化枚举不允许直接渲染到界面
 * （侧边栏「最近研究」、研究工作区、Dashboard 历史网格共用本映射）。
 * 未知取值不猜测，原样返回，便于排查新枚举值遗漏。
 */

const RESEARCH_RUN_STATUS_LABELS: Record<string, string> = {
  planning: "规划中",
  awaiting_confirmation: "待确认",
  awaiting_scope_confirmation: "待确认",
  queued: "排队中",
  researching: "进行中",
  evaluating: "进行中",
  synthesizing: "整理报告",
  verifying: "核验引用",
  completed: "已完成",
  failed: "已失败",
  cancelled: "已取消",
};

export function researchRunStatusLabel(status: string | null | undefined): string {
  if (!status) return "待开始";
  return RESEARCH_RUN_STATUS_LABELS[status] ?? status;
}

const RESEARCH_EVIDENCE_STATUS_LABELS: Record<string, string> = {
  active: "有效",
  superseded: "已被取代",
  disputed: "存在争议",
  invalidated: "已失效",
};

export function researchEvidenceStatusLabel(status: string): string {
  return RESEARCH_EVIDENCE_STATUS_LABELS[status] ?? status;
}

const RESEARCH_EVIDENCE_TYPE_LABELS: Record<string, string> = {
  direct_quote: "原文引述",
  paraphrase: "转述",
  dataset_measurement: "数据测量",
  project_context: "项目资料",
  expert_assessment: "专家评估",
  visual_observation: "图表观察",
  metadata_only: "仅元数据",
};

export function researchEvidenceTypeLabel(type: string): string {
  return RESEARCH_EVIDENCE_TYPE_LABELS[type] ?? type;
}

/**
 * 公开执行事件 → 研究问题状态的即时投影（主卡圆圈与右侧面板联动的数据源）。
 * 事件只携带公开信息：task_started 表示该问题进入检索，task_completed 表示
 * 进入评估，question_evaluated 携带评估后的确切状态。无法判断时返回 null。
 */
export function researchQuestionStatusFromEvent(
  kind: string | undefined,
  status: unknown,
): string | null {
  if (kind === "task_started") return "researching";
  if (kind === "task_completed") return "evaluating";
  if (kind === "question_evaluated" && typeof status === "string" && status) return status;
  return null;
}
