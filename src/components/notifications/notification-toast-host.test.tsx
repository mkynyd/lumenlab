import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openNotification: vi.fn(),
  dismissToast: vi.fn(),
  value: {} as Record<string, unknown>,
}));

vi.mock("./notification-provider", () => ({
  useNotifications: () => mocks.value,
}));

// jsdom 没有 matchMedia；测试默认走桌面端布局，移动端由专门的用例覆盖。
const media = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => media.mobile,
}));

import { NotificationToastHost } from "./notification-toast-host";

function toast(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    kind: "completed",
    title: "积分推导",
    summary: "回答已完成，点击查看结果",
    createdAt: new Date().toISOString(),
    targetPath: "/chat/conv-1",
    taskType: "agent_execution",
    taskId: "exec-1",
    ...overrides,
  };
}

function setToasts(toasts: unknown[], notifications: unknown[] = []) {
  mocks.value = {
    toasts,
    notifications,
    dismissToast: mocks.dismissToast,
    openNotification: mocks.openNotification,
  };
}

describe("NotificationToastHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    media.mobile = false;
    setToasts([]);
  });

  it("没有提示时不渲染宿主", () => {
    const { container } = render(<NotificationToastHost />);
    expect(container.firstChild).toBeNull();
  });

  it("提示可进入结果或关闭，且宿主使用 aria-live 播报", () => {
    setToasts([toast()]);
    render(<NotificationToastHost />);

    const host = screen.getByRole("status");
    expect(host.getAttribute("aria-live")).toBe("polite");

    fireEvent.click(screen.getByRole("button", { name: "查看结果" }));
    expect(mocks.openNotification).toHaveBeenCalledWith("n1");

    fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));
    expect(mocks.dismissToast).toHaveBeenCalledWith("n1");
  });

  it("失败通知额外提供重试入口", () => {
    setToasts([toast({ kind: "failed", summary: "执行失败，可在对话中重试" })]);
    render(<NotificationToastHost />);

    fireEvent.click(screen.getByRole("button", { name: "打开对话重试" }));
    expect(mocks.openNotification).toHaveBeenCalledWith("n1");
  });

  it("列表里的标题更新后，提示显示最新标题", () => {
    setToasts([toast({ title: "新对话" })], [toast({ title: "热力学第二定律解释" })]);
    render(<NotificationToastHost />);

    expect(screen.getByText("热力学第二定律解释")).toBeTruthy();
    expect(screen.queryByText("新对话")).toBeNull();
  });

  it("取消通知不提供重试入口", () => {
    setToasts([toast({ kind: "cancelled" })]);
    render(<NotificationToastHost />);

    expect(screen.queryByRole("button", { name: "打开对话重试" })).toBeNull();
  });

  it("移动端渲染顶部胶囊：单行标题、无查看结果按钮", () => {
    media.mobile = true;
    setToasts([toast()]);
    render(<NotificationToastHost />);

    const host = screen.getByRole("status");
    expect(host.className).toContain("top-16");
    expect(screen.getByRole("button", { name: /积分推导/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "查看结果" })).toBeNull();
    media.mobile = false;
  });
});
