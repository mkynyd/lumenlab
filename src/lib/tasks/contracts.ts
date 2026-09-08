/**
 * 任务 10：后台任务的公开合同。
 *
 * 任务事实由各自的任务源持有（当前 main 只有 AgentExecution），本模块只定义
 * 用户可见的最小 DTO 与状态语义。DTO 不得携带 prompt、Checkpoint、供应商
 * key、内部错误栈或任何未鉴权资源引用。
 */

export const TASK_STATUSES = [
  "queued",
  "running",
  "waiting_user",
  "completed",
  "failed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  "queued",
  "running",
  "waiting_user",
];

export const TASK_TERMINAL_STATUSES: readonly TaskStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export const DEFAULT_ACTIVE_TASK_LIMIT = 10;
export const MAX_ACTIVE_TASK_LIMIT = 50;

export interface TaskSnapshot {
  taskId: string;
  /** 任务源标识，如 agent_execution；11 接入 Paper 后新增取值。 */
  taskType: string;
  /** 用户可见标题（来自会话/项目标题等既有可见字段，不是原始 prompt）。 */
  title: string;
  status: TaskStatus;
  /** 当前阶段文案；无阶段时为 null。 */
  stage: string | null;
  /** 已完成单元数（如已结束的工具调用数）；无真实总量时为 null。 */
  completedUnits: number | null;
  /** 总单元数；未知时为 null，前端显示不定进度而不是虚构百分比。 */
  totalUnits: number | null;
  updatedAt: string;
  /** 服务器生成的站内允许路径，用于点击进入结果。 */
  resultPath: string | null;
  canRetry: boolean;
  canCancel: boolean;
}

export interface TaskSource {
  readonly taskType: string;
  listActive(input: { userId: string; limit?: number }): Promise<TaskSnapshot[]>;
  getOwned(input: { userId: string; taskId: string }): Promise<TaskSnapshot | null>;
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    typeof value === "string" &&
    (TASK_STATUSES as readonly string[]).includes(value)
  );
}

export function isActiveTaskStatus(status: TaskStatus): boolean {
  return ACTIVE_TASK_STATUSES.includes(status);
}

export function normalizeTaskLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_ACTIVE_TASK_LIMIT;
  if (!Number.isFinite(value)) return DEFAULT_ACTIVE_TASK_LIMIT;
  const floored = Math.floor(value);
  if (floored < 1) return 1;
  return Math.min(floored, MAX_ACTIVE_TASK_LIMIT);
}

/**
 * 进度文案：有总量时给出“已完成 x/y”，无总量时只给阶段，避免常驻假百分比。
 */
export function taskProgressLabel(task: {
  stage: string | null;
  completedUnits: number | null;
  totalUnits: number | null;
}): string {
  const stage = task.stage?.trim() ?? "";
  const hasTotal =
    typeof task.totalUnits === "number" && task.totalUnits > 0;
  const completed = Math.max(0, task.completedUnits ?? 0);
  if (hasTotal) {
    const bounded = Math.min(completed, task.totalUnits as number);
    return stage ? `${stage} · ${bounded}/${task.totalUnits}` : `${bounded}/${task.totalUnits}`;
  }
  if (stage && completed > 0) return `${stage} · 已完成 ${completed} 项`;
  return stage || "进行中";
}

/** 终态任务的文案；等待用户时归入“待处理”。 */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  queued: "排队中",
  running: "进行中",
  waiting_user: "等待你的确认",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
