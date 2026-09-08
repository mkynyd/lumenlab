"use client";

import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock3,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { NOTIFICATION_KIND_LABELS } from "@/lib/notifications/contracts";
import { useNotifications, type NotificationToast } from "./notification-provider";

function ToastIcon({ kind }: { kind: NotificationToast["kind"] }) {
  if (kind === "completed") {
    return <CircleCheck size={16} className="text-[var(--color-success)]" aria-hidden />;
  }
  if (kind === "failed") {
    return <CircleX size={16} className="text-[var(--color-error)]" aria-hidden />;
  }
  if (kind === "waiting_user") {
    return <CircleAlert size={16} className="text-[var(--color-warning,#b45309)]" aria-hidden />;
  }
  return <Clock3 size={16} className="text-[var(--color-text-tertiary)]" aria-hidden />;
}

/**
 * 通知提示宿主。
 * - 移动端：顶部居中的胶囊，落在悬浮导航下方，点击进入结果；移动端不提供通知面板入口。
 * - 桌面端：右下角轻量卡片，位置避开聊天发送按钮与反馈按钮。
 * 键盘焦点不被抢走：容器不自动聚焦，关闭按钮只是普通按钮。
 */
export function NotificationToastHost() {
  const { toasts, notifications, dismissToast, openNotification } =
    useNotifications();
  const isMobile = useIsMobile();
  if (toasts.length === 0) return null;

  // 提示是一次性快照，标题可能还是「新对话」；列表里的同一条通知已带上
  // 当前会话标题，这里优先显示它，避免同一个任务出现两种标题。
  const latestById = new Map(
    (notifications ?? []).map((notification) => [notification.id, notification])
  );

  return (
    <div
      className={cn(
        "pointer-events-none fixed z-40 flex flex-col gap-2",
        isMobile
          ? "inset-x-0 top-16 items-center px-4"
          : "bottom-20 right-6 w-[20rem] items-stretch"
      )}
      role="status"
      aria-live="polite"
      aria-label="任务通知"
    >
      {toasts.map((toast) => {
        const latest = latestById.get(toast.id);
        const title = latest?.title ?? toast.title;
        const summary = latest?.summary ?? toast.summary;

        if (isMobile) {
          return (
            <div
              key={toast.id}
              className={cn(
                "pointer-events-auto flex w-full max-w-[22rem] items-center gap-2",
                "rounded-full bg-[var(--color-panel)] py-1.5 pl-3 pr-1.5",
                "shadow-[var(--shadow-pill)]",
                "motion-safe:animate-[assistant-source-enter_180ms_cubic-bezier(0.23,1,0.32,1)_both]"
              )}
            >
              <span className="inline-flex size-4 shrink-0 items-center justify-center">
                <ToastIcon kind={toast.kind} />
              </span>
              <button
                type="button"
                onClick={() => void openNotification(toast.id)}
                className="min-w-0 flex-1 py-1 text-left"
              >
                <span className="block truncate text-xs font-medium text-[var(--color-text-primary)]">
                  {title}
                </span>
              </button>
              <span className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
                {NOTIFICATION_KIND_LABELS[toast.kind]}
              </span>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="关闭通知"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]"
              >
                <X size={13} aria-hidden />
              </button>
            </div>
          );
        }

        return (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2 rounded-[var(--radius-lg)]",
              "bg-[var(--color-panel)] p-3 shadow-[var(--shadow-pill)]",
              "motion-safe:animate-[assistant-source-enter_180ms_cubic-bezier(0.23,1,0.32,1)_both]"
            )}
          >
            <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
              <ToastIcon kind={toast.kind} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-[var(--color-text-primary)]">
                {title}
              </p>
              {summary && (
                <p className="mt-0.5 text-[11px] leading-4 text-[var(--color-text-secondary)]">
                  {summary}
                </p>
              )}
              <div className="mt-1.5 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void openNotification(toast.id)}
                  className="h-6 rounded-[var(--radius-md)] bg-[var(--color-panel-muted)] px-2 text-[11px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-interaction-active)] hover:text-[var(--color-text-primary)]"
                >
                  查看结果
                </button>
                {toast.kind === "failed" && (
                  <button
                    type="button"
                    onClick={() => void openNotification(toast.id)}
                    className="h-6 rounded-[var(--radius-md)] px-2 text-[11px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]"
                  >
                    打开对话重试
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="关闭通知"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-interaction-hover)] hover:text-[var(--color-text-primary)]"
            >
              <X size={13} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
