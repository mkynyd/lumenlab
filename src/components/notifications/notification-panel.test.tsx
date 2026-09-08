import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  markAllRead: vi.fn(),
  markRead: vi.fn(),
  openNotification: vi.fn(),
  dismissToast: vi.fn(),
  value: {} as Record<string, unknown>,
}));

vi.mock("./notification-provider", () => ({
  useNotifications: () => mocks.value,
}));

import { NotificationPanel } from "./notification-panel";

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

function task(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "exec-1",
    taskType: "agent_execution",
    title: "概率作业",
    status: "running",
    stage: "正在执行工具",
    completedUnits: 2,
    totalUnits: null,
    updatedAt: new Date().toISOString(),
    resultPath: "/chat/conv-1",
    canRetry: false,
    canCancel: true,
    ...overrides,
  };
}

function setValue(overrides: Record<string, unknown> = {}) {
  mocks.value = {
    status: "ready",
    error: null,
    notifications: [],
    unreadCount: 0,
    tasks: [],
    refresh: mocks.refresh,
    markAllRead: mocks.markAllRead,
    markRead: mocks.markRead,
    openNotification: mocks.openNotification,
    toasts: [],
    dismissToast: mocks.dismissToast,
    ...overrides,
  };
}

describe("NotificationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setValue();
  });

  it("空态显示提示，且没有未读时全部已读不可点", () => {
    render(<NotificationPanel />);
    expect(screen.getByText("还没有通知")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /全部已读/ }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("进行中任务显示阶段与已完成数量，不使用虚构百分比", () => {
    setValue({ tasks: [task()] });
    render(<NotificationPanel />);

    expect(screen.getByText("进行中 · 1")).toBeTruthy();
    expect(screen.getByText("概率作业")).toBeTruthy();
    expect(screen.getByText("正在执行工具 · 已完成 2 项")).toBeTruthy();
    expect(document.body.textContent).not.toContain("%");
  });

  it("未读与已读通知的筛选与标记", () => {
    setValue({
      unreadCount: 1,
      notifications: [
        notification({ id: "n1" }),
        notification({ id: "n2", title: "已读通知", readAt: new Date().toISOString() }),
      ],
    });
    render(<NotificationPanel />);

    expect(screen.getByText("积分推导")).toBeTruthy();
    expect(screen.getByText("已读通知")).toBeTruthy();
    expect(screen.getAllByLabelText("未读")).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: "未读" }));
    expect(screen.queryByText("已读通知")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "标记当前未读为已读" }));
    expect(mocks.markRead).toHaveBeenCalledWith(["n1"]);
  });

  it("点击通知会打开结果并关闭面板", () => {
    setValue({ unreadCount: 1, notifications: [notification()] });
    const onNavigate = vi.fn();
    render(<NotificationPanel onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole("button", { name: /积分推导/ }));
    expect(onNavigate).toHaveBeenCalled();
    expect(mocks.openNotification).toHaveBeenCalledWith("n1");
  });

  it("全部已读按钮在存在未读时可用", () => {
    setValue({ unreadCount: 3, notifications: [notification()] });
    render(<NotificationPanel />);

    fireEvent.click(screen.getByRole("button", { name: /全部已读/ }));
    expect(mocks.markAllRead).toHaveBeenCalled();
  });

  it("加载失败时给出错误与重试", () => {
    setValue({ status: "error", error: "通知加载失败" });
    render(<NotificationPanel />);

    expect(screen.getByText("通知加载失败")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("加载中显示占位而不显示空态", () => {
    setValue({ status: "loading" });
    render(<NotificationPanel />);
    expect(screen.queryByText("还没有通知")).toBeNull();
  });
});
