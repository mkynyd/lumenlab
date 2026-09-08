/**
 * 任务 10：站内通知合同。
 *
 * 通知是任务事实的**用户可见投影**：只保存用户需要感知的状态变化与已读/已弹出
 * 状态，不保存 prompt、Checkpoint、内部错误或供应商信息。
 */

export const NOTIFICATION_KINDS = [
  "waiting_user",
  "completed",
  "failed",
  "cancelled",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  waiting_user: "待处理",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export interface NotificationDto {
  id: string;
  taskType: string;
  taskId: string;
  kind: NotificationKind;
  title: string;
  summary: string | null;
  targetPath: string | null;
  createdAt: string;
  readAt: string | null;
  toastAcknowledgedAt: string | null;
}

export function isNotificationKind(value: unknown): value is NotificationKind {
  return (
    typeof value === "string" &&
    (NOTIFICATION_KINDS as readonly string[]).includes(value)
  );
}

/** 幂等键：同一次任务尝试的同一种变化只对应一条通知。 */
export function notificationEventKey(input: {
  taskType: string;
  taskId: string;
  taskAttempt: number;
  kind: NotificationKind;
}): string {
  return `${input.taskType}:${input.taskId}:${input.taskAttempt}:${input.kind}`;
}

/**
 * 站内路径白名单：只接受服务器生成的、已知工作区内的相对路径。
 * 拒绝协议相对地址（`//host`）、反斜杠、`..`、空白、查询串与 hash，
 * 防止开放重定向。
 */
const ALLOWED_PATH_SECTIONS = new Set([
  "chat",
  "projects",
  "tools",
  "learning",
  "today",
  "usage",
  "home",
  "artifacts",
  "papers",
]);

export function safeNotificationTargetPath(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return null;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  if (/[\s\\?#]/.test(trimmed)) return null;
  if (trimmed.includes("..")) return null;
  if (!/^\/[A-Za-z0-9._~\-/]*$/.test(trimmed)) return null;
  const [section] = trimmed.slice(1).split("/");
  if (!ALLOWED_PATH_SECTIONS.has(section)) return null;
  return trimmed;
}

export function toNotificationDto(row: {
  id: string;
  taskType: string;
  taskId: string;
  kind: string;
  title: string;
  summary: string | null;
  targetPath: string | null;
  createdAt: Date;
  readAt: Date | null;
  toastAcknowledgedAt: Date | null;
}): NotificationDto {
  return {
    id: row.id,
    taskType: row.taskType,
    taskId: row.taskId,
    kind: isNotificationKind(row.kind) ? row.kind : "completed",
    title: row.title,
    summary: row.summary,
    targetPath: safeNotificationTargetPath(row.targetPath),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    toastAcknowledgedAt: row.toastAcknowledgedAt?.toISOString() ?? null,
  };
}

export const NOTIFICATION_PAGE_SIZE = 20;
export const MAX_NOTIFICATION_PAGE_SIZE = 50;

export function normalizeNotificationLimit(value: number | undefined): number {
  if (value === undefined) return NOTIFICATION_PAGE_SIZE;
  if (!Number.isFinite(value)) return NOTIFICATION_PAGE_SIZE;
  const floored = Math.floor(value);
  if (floored < 1) return 1;
  return Math.min(floored, MAX_NOTIFICATION_PAGE_SIZE);
}
