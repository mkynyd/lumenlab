"use client";

import { useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
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

type Filter = "all" | "unread";
const FILTER_TABS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "unread", label: "未读" },
];

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

function IconChip({ unread, children }: { unread?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-colors duration-150",
        unread
          ? "bg-[color-mix(in_oklch,var(--color-accent)_14%,transparent)]"
          : "bg-[var(--color-panel-muted)]"
      )}
    >
      {children}
    </span>
  );
}

function ActiveTaskRow({ task }: { task: TaskSnapshot }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-[var(--radius-md)] px-2 py-2"
      data-task-status={task.status}
    >
      <IconChip>
        <TaskStatusIcon status={task.status} />
      </IconChip>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-5 font-medium text-[var(--color-text-primary)]">
          {task.title}
        </span>
        <span className="block truncate text-xs leading-5 text-[var(--color-text-tertiary)]">
          {taskProgressLabel(task)}
        </span>
      </span>
      <span className="shrink-0 text-xs leading-5 text-[var(--color-text-tertiary)] tabular-nums">
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
  const uid = useId();
  const reduceMotion = useReducedMotion();
  const [filter, setFilter] = useState<Filter>("all");
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
      <div className="flex shrink-0 items-center justify-between gap-2 px-1 pb-2">
        <div
          role="tablist"
          aria-label="通知筛选"
          className="inline-flex rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] p-0.5"
        >
          {FILTER_TABS.map(({ value, label }) => {
            const selected = filter === value;
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setFilter(value)}
                className={cn(
                  "relative inline-flex h-7 items-center rounded-[8px] px-2.5 text-xs",
                  "transition-colors duration-150 motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:bg-[var(--color-interaction-active)]",
                  selected
                    ? "font-medium text-[var(--color-text-primary)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                )}
              >
                {selected && (
                  <motion.span
                    layoutId={`${uid}-filter-pill`}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 420, damping: 34 }
                    }
                    className="absolute inset-0 rounded-[8px] bg-[var(--color-surface)]"
                  />
                )}
                <span className="relative">{label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={busy || unreadCount === 0}
          onClick={() => void run(markAllRead)}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-md)] px-2 text-xs",
            "text-[var(--color-text-secondary)] transition-colors duration-150 motion-reduce:transition-none",
            "hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]",
            "focus-visible:bg-[var(--color-interaction-active)] focus-visible:outline-none",
            "disabled:opacity-40 disabled:hover:bg-transparent"
          )}
        >
          <CheckCheck size={13} aria-hidden />
          全部已读
        </button>
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
                  "flex w-full items-start gap-2.5 rounded-[var(--radius-md)] px-2 py-2 text-left",
                  "transition-colors duration-150 motion-reduce:transition-none",
                  "hover:bg-[var(--color-interaction-hover)]",
                  "focus-visible:bg-[var(--color-interaction-active)] focus-visible:outline-none"
                )}
              >
                <IconChip unread={!notification.readAt}>
                  <KindIcon kind={notification.kind} />
                </IconChip>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "truncate text-[13px] leading-5",
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
                  <span className="block truncate text-xs leading-5 text-[var(--color-text-tertiary)]">
                    {NOTIFICATION_KIND_LABELS[notification.kind]}
                    {notification.summary ? ` · ${notification.summary}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs leading-5 text-[var(--color-text-tertiary)] tabular-nums">
                  {relativeTime(notification.createdAt)}
                </span>
              </button>
            ))}
          </section>
        ) : null}

        {status !== "loading" && visible.length === 0 && tasks.length === 0 ? (
          <div className="flex min-h-[11rem] flex-col items-center justify-center gap-1 px-4 py-6 text-center">
            <span className="flex size-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-panel-muted)]">
              <Bell size={16} className="text-[var(--color-text-tertiary)]" aria-hidden />
            </span>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
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
            className="h-8 w-full rounded-[var(--radius-md)] text-xs text-[var(--color-text-secondary)] transition-colors duration-150 hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)] disabled:opacity-40 motion-reduce:transition-none"
          >
            标记当前未读为已读
          </button>
        </div>
      ) : null}
    </div>
  );
}
