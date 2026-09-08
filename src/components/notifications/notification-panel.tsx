"use client";

import { useState } from "react";
import {
  Bell,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock3,
  Loader2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  NOTIFICATION_KIND_LABELS,
  type NotificationDto,
} from "@/lib/notifications/contracts";
import { taskProgressLabel, type TaskSnapshot } from "@/lib/tasks/contracts";
import { useNotifications } from "./notification-provider";

function relativeTime(value: string, now = Date.now()): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const diff = Math.max(0, now - time);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(time).toLocaleDateString("zh-CN");
}

function KindIcon({ kind }: { kind: NotificationDto["kind"] }) {
  if (kind === "completed") {
    return <CircleCheck size={14} className="text-[var(--color-success)]" aria-hidden />;
  }
  if (kind === "failed") {
    return <CircleX size={14} className="text-[var(--color-error)]" aria-hidden />;
  }
  if (kind === "waiting_user") {
    return <CircleAlert size={14} className="text-[var(--color-warning,#b45309)]" aria-hidden />;
  }
  return <Clock3 size={14} className="text-[var(--color-text-tertiary)]" aria-hidden />;
}

function TaskStatusIcon({ status }: { status: TaskSnapshot["status"] }) {
  if (status === "waiting_user") {
    return <CircleAlert size={14} className="text-[var(--color-warning,#b45309)]" aria-hidden />;
  }
  return <Loader2 size={14} className="animate-spin text-[var(--color-text-tertiary)]" aria-hidden />;
}

function ActiveTaskRow({ task }: { task: TaskSnapshot }) {
  return (
    <div
      className="flex items-start gap-2 rounded-[var(--radius-md)] px-2 py-1.5"
      data-task-status={task.status}
    >
      <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
        <TaskStatusIcon status={task.status} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-[var(--color-text-primary)]">
          {task.title}
        </span>
        <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">
          {taskProgressLabel(task)}
        </span>
      </span>
      <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
        {relativeTime(task.updatedAt)}
      </span>
    </div>
  );
}

export function NotificationPanel({ onNavigate }: { onNavigate?: () => void }) {
  const {
    status,
    error,
    notifications,
    unreadCount,
    tasks,
    refresh,
    markAllRead,
    markRead,
    openNotification,
  } = useNotifications();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [busy, setBusy] = useState(false);
  const visible = filter === "unread"
    ? notifications.filter((notification) => !notification.readAt)
    : notifications;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch {
      // 错误由 provider 记录，这里只恢复按钮状态。
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-h-[min(70vh,32rem)] w-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-1 pb-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
          通知
        </span>
        {unreadCount > 0 && (
          <span className="rounded-full bg-[var(--color-panel-muted)] px-1.5 text-[11px] text-[var(--color-text-secondary)]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          disabled={busy || unreadCount === 0}
          onClick={() => void run(markAllRead)}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] px-2 text-xs",
            "text-[var(--color-text-secondary)] transition-colors",
            "hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]",
            "disabled:opacity-40 disabled:hover:bg-transparent"
          )}
        >
          <CheckCheck size={13} aria-hidden />
          全部已读
        </button>
      </div>

      <div className="flex shrink-0 gap-1 px-1 pb-2" role="tablist" aria-label="通知筛选">
        {(
          [
            ["all", "全部"],
            ["unread", "未读"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "h-7 rounded-[var(--radius-md)] px-2.5 text-xs transition-colors",
              filter === value
                ? "bg-[var(--color-interaction-active)] font-medium text-[var(--color-text-primary)]"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {status === "loading" && notifications.length === 0 ? (
          <div className="space-y-2 py-2" aria-hidden>
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-10 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-panel-muted)]"
              />
            ))}
          </div>
        ) : null}

        {status === "error" && notifications.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-2 py-3">
            <p className="text-xs text-[var(--color-error)]">
              {error ?? "通知加载失败"}
            </p>
            <button
              type="button"
              onClick={() => void run(refresh)}
              className="inline-flex h-7 items-center rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-2.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]"
            >
              重试
            </button>
          </div>
        ) : null}

        {tasks.length > 0 && (
          <section aria-label="进行中的任务" className="pb-1">
            <h3 className="px-2 pb-1 pt-1 text-[11px] font-normal uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">
              进行中 · {tasks.length}
            </h3>
            {tasks.map((task) => (
              <ActiveTaskRow key={`${task.taskType}:${task.taskId}`} task={task} />
            ))}
          </section>
        )}

        {visible.length > 0 ? (
          <section aria-label="最近通知">
            <h3 className="px-2 pb-1 pt-1 text-[11px] font-normal uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">
              最近
            </h3>
            {visible.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => {
                  onNavigate?.();
                  void openNotification(notification.id);
                }}
                className={cn(
                  "flex w-full items-start gap-2 rounded-[var(--radius-md)] px-2 py-2 text-left",
                  "transition-colors hover:bg-[var(--color-interaction-hover)]",
                  "focus-visible:bg-[var(--color-interaction-active)]"
                )}
              >
                <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
                  <KindIcon kind={notification.kind} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "truncate text-xs",
                        notification.readAt
                          ? "text-[var(--color-text-secondary)]"
                          : "font-medium text-[var(--color-text-primary)]"
                      )}
                    >
                      {notification.title}
                    </span>
                    {!notification.readAt && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]"
                        aria-label="未读"
                      />
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--color-text-tertiary)]">
                    {NOTIFICATION_KIND_LABELS[notification.kind]}
                    {notification.summary ? ` · ${notification.summary}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
                  {relativeTime(notification.createdAt)}
                </span>
              </button>
            ))}
          </section>
        ) : null}

        {status !== "loading" && visible.length === 0 && tasks.length === 0 ? (
          <div className="flex min-h-[11rem] flex-col items-center justify-center gap-1 px-4 py-6 text-center">
            <Bell size={18} className="text-[var(--color-text-tertiary)]" aria-hidden />
            <p className="text-xs text-[var(--color-text-secondary)]">
              {filter === "unread" ? "没有未读通知" : "还没有通知"}
            </p>
            <p className="text-[11px] text-[var(--color-text-tertiary)]">
              后台任务完成后会在这里提醒你。
            </p>
          </div>
        ) : null}
      </div>

      {filter === "unread" && visible.length > 0 ? (
        <div className="shrink-0 px-1 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() =>
                markRead(visible.map((notification) => notification.id))
              )
            }
            className="h-7 w-full rounded-[var(--radius-md)] text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
          >
            标记当前未读为已读
          </button>
        </div>
      ) : null}
    </div>
  );
}
