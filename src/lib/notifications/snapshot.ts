import { listActiveTasks } from "@/lib/tasks/registry";
import type { TaskSnapshot } from "@/lib/tasks/contracts";
import type { NotificationDto } from "./contracts";
import { countUnread, listRecentNotifications } from "./notification-store";

export const NOTIFICATION_SNAPSHOT_LIMIT = 20;

export interface NotificationSnapshot {
  notifications: NotificationDto[];
  unreadCount: number;
  tasks: TaskSnapshot[];
  /**
   * 快照版本：通知最新 createdAt + 未读数 + 进行中任务签名。
   * 客户端用它在轮询回退时跳过重复渲染，并作为 SSE 的 Last-Event-ID。
   */
  version: string;
}

function versionOf(input: {
  notifications: NotificationDto[];
  unreadCount: number;
  tasks: TaskSnapshot[];
}): string {
  const latest = input.notifications[0]?.createdAt ?? "0";
  const taskSignature = input.tasks
    .map((task) => `${task.taskId}:${task.status}:${task.completedUnits ?? 0}:${task.updatedAt}`)
    .join("|");
  return `${latest}~${input.unreadCount}~${input.notifications.length}~${taskSignature}`;
}

export async function buildNotificationSnapshot(input: {
  userId: string;
  limit?: number;
  taskLimit?: number;
}): Promise<NotificationSnapshot> {
  const [notifications, unreadCount, tasks] = await Promise.all([
    listRecentNotifications({
      userId: input.userId,
      limit: input.limit ?? NOTIFICATION_SNAPSHOT_LIMIT,
    }),
    countUnread(input.userId),
    listActiveTasks({ userId: input.userId, limit: input.taskLimit }),
  ]);
  return {
    notifications,
    unreadCount,
    tasks,
    version: versionOf({ notifications, unreadCount, tasks }),
  };
}
