"use client";

import type { NotificationDto } from "@/lib/notifications/contracts";
import type { TaskSnapshot } from "@/lib/tasks/contracts";

export interface NotificationSnapshotPayload {
  notifications: NotificationDto[];
  unreadCount: number;
  tasks: TaskSnapshot[];
  version: string;
}

export async function readError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // 非 JSON 错误体：退回通用文案。
  }
  return fallback;
}

export async function fetchNotificationSnapshot(
  signal?: AbortSignal
): Promise<NotificationSnapshotPayload> {
  const response = await fetch("/api/notifications/snapshot", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(await readError(response, "通知加载失败"));
  }
  return (await response.json()) as NotificationSnapshotPayload;
}

export async function fetchNotificationPage(input: {
  filter: "all" | "unread";
  cursor?: string | null;
}): Promise<{
  items: NotificationDto[];
  nextCursor: string | null;
  unreadCount: number;
}> {
  const params = new URLSearchParams({ filter: input.filter, limit: "20" });
  if (input.cursor) params.set("cursor", input.cursor);
  const response = await fetch(`/api/notifications?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "通知加载失败"));
  }
  return await response.json();
}

export async function postMarkRead(input: {
  ids?: string[];
  all?: boolean;
}): Promise<void> {
  const response = await fetch("/api/notifications/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "标记已读失败"));
  }
}

export async function claimNotificationToasts(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const response = await fetch("/api/notifications/toast-ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "通知提示确认失败"));
  }
  const payload = (await response.json()) as { claimed?: unknown };
  return Array.isArray(payload.claimed)
    ? payload.claimed.filter((id): id is string => typeof id === "string")
    : [];
}

export interface NotificationTarget {
  targetPath: string;
  notification: NotificationDto;
  task: TaskSnapshot | null;
}

export async function resolveNotificationTarget(
  id: string
): Promise<NotificationTarget> {
  const response = await fetch(`/api/notifications/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "结果已不可访问"));
  }
  const payload = (await response.json()) as {
    targetPath?: unknown;
    notification?: unknown;
    task?: unknown;
  };
  if (typeof payload.targetPath !== "string") {
    throw new Error("结果已不可访问");
  }
  return {
    targetPath: payload.targetPath,
    notification: payload.notification as NotificationDto,
    task: (payload.task ?? null) as TaskSnapshot | null,
  };
}

/** 超过这个时间的未弹出通知只进列表，不补弹窗，避免离开很久后一次性弹一串。 */
export const TOAST_FRESHNESS_MS = 30 * 60 * 1_000;

export function isFreshNotification(
  notification: NotificationDto,
  now = Date.now()
): boolean {
  const createdAt = Date.parse(notification.createdAt);
  if (!Number.isFinite(createdAt)) return true;
  return now - createdAt <= TOAST_FRESHNESS_MS;
}
