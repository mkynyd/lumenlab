"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  claimNotificationToasts,
  fetchNotificationSnapshot,
  isFreshNotification,
  postMarkRead,
  resolveNotificationTarget,
  type NotificationSnapshotPayload,
} from "@/lib/notifications/client";
import {
  safeNotificationTargetPath,
  type NotificationDto,
} from "@/lib/notifications/contracts";
import type { TaskSnapshot } from "@/lib/tasks/contracts";
import { queryKeys } from "@/lib/query-keys";

/** SSE 断开后的轮询回退间隔。 */
export const POLL_INTERVAL_MS = 20_000;
const TOAST_LIMIT = 3;
const TOAST_TTL_MS = 9_000;

export interface NotificationToast {
  id: string;
  kind: NotificationDto["kind"];
  title: string;
  summary: string | null;
  createdAt: string;
  targetPath: string | null;
  taskType: string;
  taskId: string;
}

interface NotificationContextValue {
  status: "loading" | "ready" | "error";
  error: string | null;
  notifications: NotificationDto[];
  unreadCount: number;
  tasks: TaskSnapshot[];
  refresh: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  openNotification: (id: string) => Promise<void>;
  toasts: NotificationToast[];
  dismissToast: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications(): NotificationContextValue {
  const value = useContext(NotificationContext);
  if (!value) {
    throw new Error("useNotifications 必须在 NotificationProvider 内使用");
  }
  return value;
}

function toToast(notification: NotificationDto): NotificationToast {
  return {
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    summary: notification.summary,
    createdAt: notification.createdAt,
    targetPath: notification.targetPath,
    taskType: notification.taskType,
    taskId: notification.taskId,
  };
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [toasts, setToasts] = useState<NotificationToast[]>([]);
  const [connected, setConnected] = useState(false);
  const claimedRef = useRef<Set<string>>(new Set());
  const handledVersionRef = useRef<string | null>(null);

  const snapshotQuery = useQuery({
    queryKey: queryKeys.notifications.snapshot,
    queryFn: () => fetchNotificationSnapshot(),
    // SSE 连通时不做轮询；断线后按间隔回退拉取。
    refetchInterval: connected ? false : POLL_INTERVAL_MS,
    refetchOnWindowFocus: !connected,
    staleTime: 10_000,
  });

  const snapshot = snapshotQuery.data;
  const notifications = useMemo(
    () => snapshot?.notifications ?? [],
    [snapshot]
  );
  const tasks = useMemo(() => snapshot?.tasks ?? [], [snapshot]);
  const unreadCount = snapshot?.unreadCount ?? 0;
  const status: NotificationContextValue["status"] = snapshotQuery.isPending
    ? "loading"
    : snapshotQuery.isError && !snapshot
      ? "error"
      : "ready";
  const error = snapshotQuery.isError
    ? snapshotQuery.error instanceof Error
      ? snapshotQuery.error.message
      : "通知加载失败"
    : null;

  const applySnapshot = useCallback(
    (payload: NotificationSnapshotPayload) => {
      queryClient.setQueryData(queryKeys.notifications.snapshot, payload);
    },
    [queryClient]
  );

  // 单一监听器：SSE 实时推送，断线时回退轮询；退出登录时组件卸载即关闭。
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }
    let source: EventSource | null = null;
    let disposed = false;

    try {
      source = new EventSource("/api/notifications/stream");
      source.addEventListener("snapshot", (event) => {
        if (disposed) return;
        setConnected(true);
        try {
          applySnapshot(
            JSON.parse((event as MessageEvent).data) as NotificationSnapshotPayload
          );
        } catch {
          // 忽略单条畸形事件，下一次快照会纠正。
        }
      });
      source.onopen = () => {
        if (!disposed) setConnected(true);
      };
      source.onerror = () => {
        // EventSource 会自动重连；期间由 query 的 refetchInterval 兜底。
        if (!disposed) setConnected(false);
      };
    } catch {
      // 构造失败时保持未连接状态，轮询回退照常生效。
    }

    return () => {
      disposed = true;
      source?.close();
    };
  }, [applySnapshot]);

  // 新快照 → 认领“已弹出” → 只对认领成功的条目入队提示。
  useEffect(() => {
    if (!snapshot || handledVersionRef.current === snapshot.version) return;
    handledVersionRef.current = snapshot.version;
    const pending = snapshot.notifications.filter(
      (notification) =>
        !notification.toastAcknowledgedAt && !claimedRef.current.has(notification.id)
    );
    if (pending.length === 0) return;
    for (const notification of pending) claimedRef.current.add(notification.id);
    const freshIds = new Set(
      pending
        .filter((notification) => isFreshNotification(notification))
        .map((notification) => notification.id)
    );

    void claimNotificationToasts(pending.map((notification) => notification.id))
      .then((claimed) => {
        const claimedFresh = pending.filter(
          (notification) =>
            claimed.includes(notification.id) && freshIds.has(notification.id)
        );
        if (claimedFresh.length === 0) return;
        setToasts((current) => {
          const known = new Set(current.map((toast) => toast.id));
          return [
            ...current,
            ...claimedFresh
              .filter((notification) => !known.has(notification.id))
              .map(toToast),
          ].slice(-TOAST_LIMIT);
        });
      })
      .catch(() => {
        // 认领失败：通知仍在列表中，下一次快照重试。
        for (const notification of pending) claimedRef.current.delete(notification.id);
      });
  }, [snapshot]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, TOAST_TTL_MS)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.notifications.snapshot,
    });
  }, [queryClient]);

  const markRead = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      await postMarkRead({ ids });
      const now = new Date().toISOString();
      queryClient.setQueryData<NotificationSnapshotPayload>(
        queryKeys.notifications.snapshot,
        (current) =>
          current
            ? {
                ...current,
                unreadCount: Math.max(0, current.unreadCount - ids.length),
                notifications: current.notifications.map((notification) =>
                  ids.includes(notification.id) && !notification.readAt
                    ? { ...notification, readAt: now }
                    : notification
                ),
              }
            : current
      );
      // 未读计数以服务端快照为准；不阻塞点击后的跳转。
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.snapshot,
      });
    },
    [queryClient]
  );

  const markAllRead = useCallback(async () => {
    await postMarkRead({ all: true });
    const now = new Date().toISOString();
    queryClient.setQueryData<NotificationSnapshotPayload>(
      queryKeys.notifications.snapshot,
      (current) =>
        current
          ? {
              ...current,
              unreadCount: 0,
              notifications: current.notifications.map((notification) =>
                notification.readAt ? notification : { ...notification, readAt: now }
              ),
            }
          : current
    );
    void queryClient.invalidateQueries({
      queryKey: queryKeys.notifications.snapshot,
    });
  }, [queryClient]);

  const openNotification = useCallback(
    async (id: string) => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      // 列表里的 targetPath 已在写入与读取时通过站内白名单校验，可以立即跳转；
      // 详情接口随后重新鉴权，任务被删除或权限被撤销时回退到安全页。
      const known = notifications.find((notification) => notification.id === id);
      const initialPath = safeNotificationTargetPath(known?.targetPath);
      if (initialPath) router.push(initialPath);
      try {
        const target = await resolveNotificationTarget(id);
        if (target.targetPath !== initialPath) router.push(target.targetPath);
        void markRead([id]).catch(() => {});
      } catch {
        if (initialPath) router.replace("/chat");
        await refresh();
      }
    },
    [markRead, notifications, refresh, router]
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo<NotificationContextValue>(
    () => ({
      status,
      error,
      notifications,
      unreadCount,
      tasks,
      refresh,
      markAllRead,
      markRead,
      openNotification,
      toasts,
      dismissToast,
    }),
    [
      dismissToast,
      error,
      markAllRead,
      markRead,
      notifications,
      openNotification,
      refresh,
      status,
      tasks,
      toasts,
      unreadCount,
    ]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}
