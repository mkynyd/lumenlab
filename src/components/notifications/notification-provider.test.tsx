import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  fetchSnapshot: vi.fn(),
  claimToasts: vi.fn(),
  markRead: vi.fn(),
  resolveTarget: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/notifications/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/notifications/client")>();
  return {
    ...actual,
    fetchNotificationSnapshot: mocks.fetchSnapshot,
    claimNotificationToasts: mocks.claimToasts,
    postMarkRead: mocks.markRead,
    resolveNotificationTarget: mocks.resolveTarget,
  };
});

import {
  NotificationProvider,
  POLL_INTERVAL_MS,
  useNotifications,
} from "./notification-provider";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }

  close() {
    this.closed = true;
  }
}

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    taskType: "agent_execution",
    taskId: "exec-1",
    kind: "completed",
    title: "积分推导",
    summary: "回答已完成，点击查看结果",
    targetPath: "/chat/conv-1",
    createdAt: new Date().toISOString(),
    readAt: null,
    toastAcknowledgedAt: null,
    ...overrides,
  };
}

function snapshot(payload: Record<string, unknown> = {}) {
  return {
    notifications: [],
    unreadCount: 0,
    tasks: [],
    version: "v1",
    ...payload,
  };
}

function Probe() {
  const { status, unreadCount, toasts, notifications, tasks } =
    useNotifications();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="unread">{unreadCount}</span>
      <span data-testid="toasts">{toasts.map((toast) => toast.id).join(",")}</span>
      <span data-testid="items">{notifications.map((item) => item.id).join(",")}</span>
      <span data-testid="tasks">{tasks.map((task) => task.taskId).join(",")}</span>
    </div>
  );
}

function renderProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <Probe />
      </NotificationProvider>
    </QueryClientProvider>
  );
}

describe("NotificationProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource as never);
    mocks.fetchSnapshot.mockResolvedValue(snapshot());
    mocks.claimToasts.mockResolvedValue([]);
    mocks.markRead.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("首屏拉取快照并建立唯一订阅，卸载时关闭", async () => {
    mocks.fetchSnapshot.mockResolvedValue(
      snapshot({ unreadCount: 2, notifications: [notification()] })
    );
    const view = renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("status").textContent).toBe("ready");
    });
    expect(screen.getByTestId("unread").textContent).toBe("2");
    expect(screen.getByTestId("items").textContent).toBe("n1");
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/notifications/stream");

    view.unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("SSE 快照替换投影，并对认领成功的通知弹出提示", async () => {
    mocks.claimToasts.mockResolvedValue(["n1"]);
    renderProvider();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    await act(async () => {
      FakeEventSource.instances[0].emit(
        "snapshot",
        snapshot({ notifications: [notification()], unreadCount: 1, version: "v2" })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("toasts").textContent).toBe("n1");
    });
    expect(mocks.claimToasts).toHaveBeenCalledWith(["n1"]);
    expect(screen.getByTestId("unread").textContent).toBe("1");
  });

  it("同一版本不重复认领，重复事件不会重复弹窗", async () => {
    mocks.claimToasts.mockResolvedValue(["n1"]);
    renderProvider();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    await act(async () => {
      FakeEventSource.instances[0].emit(
        "snapshot",
        snapshot({ notifications: [notification()], version: "v2" })
      );
    });
    await waitFor(() => expect(mocks.claimToasts).toHaveBeenCalledTimes(1));

    await act(async () => {
      FakeEventSource.instances[0].emit(
        "snapshot",
        snapshot({ notifications: [notification()], version: "v2" })
      );
    });
    expect(mocks.claimToasts).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("toasts").textContent).toBe("n1");
  });

  it("其他标签页已认领时不弹窗，但通知仍在列表里", async () => {
    mocks.claimToasts.mockResolvedValue([]);
    renderProvider();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    await act(async () => {
      FakeEventSource.instances[0].emit(
        "snapshot",
        snapshot({ notifications: [notification()], unreadCount: 1, version: "v3" })
      );
    });

    await waitFor(() => expect(mocks.claimToasts).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("toasts").textContent).toBe("");
    expect(screen.getByTestId("items").textContent).toBe("n1");
  });

  it("过期的未弹出通知只认领不补弹", async () => {
    mocks.claimToasts.mockResolvedValue(["n1"]);
    renderProvider();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    await act(async () => {
      FakeEventSource.instances[0].emit(
        "snapshot",
        snapshot({
          notifications: [
            notification({
              createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
            }),
          ],
          version: "v4",
        })
      );
    });

    await waitFor(() => expect(mocks.claimToasts).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("toasts").textContent).toBe("");
  });

  it("已弹出的通知不再认领", async () => {
    renderProvider();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    await act(async () => {
      FakeEventSource.instances[0].emit(
        "snapshot",
        snapshot({
          notifications: [notification({ toastAcknowledgedAt: new Date().toISOString() })],
          version: "v5",
        })
      );
    });

    expect(mocks.claimToasts).not.toHaveBeenCalled();
  });

  it("SSE 断开后回退轮询并重新拉取快照", async () => {
    vi.useFakeTimers();
    try {
      renderProvider();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(FakeEventSource.instances).toHaveLength(1);
      const callsBefore = mocks.fetchSnapshot.mock.calls.length;

      await act(async () => {
        FakeEventSource.instances[0].onerror?.();
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS + 100);
      });

      expect(mocks.fetchSnapshot.mock.calls.length).toBeGreaterThan(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });
});
