import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_PAGE_SIZE,
  isNotificationKind,
  normalizeNotificationLimit,
  notificationEventKey,
  safeNotificationTargetPath,
  toNotificationDto,
} from "./contracts";

describe("通知合同", () => {
  it("幂等键包含任务类型、任务 ID、尝试次数与变化类型", () => {
    expect(
      notificationEventKey({
        taskType: "agent_execution",
        taskId: "exec-1",
        taskAttempt: 2,
        kind: "completed",
      })
    ).toBe("agent_execution:exec-1:2:completed");
    expect(
      notificationEventKey({
        taskType: "agent_execution",
        taskId: "exec-1",
        taskAttempt: 3,
        kind: "completed",
      })
    ).not.toBe(
      notificationEventKey({
        taskType: "agent_execution",
        taskId: "exec-1",
        taskAttempt: 2,
        kind: "completed",
      })
    );
  });

  it("只接受站内白名单路径，拒绝开放重定向与非法字符", () => {
    expect(safeNotificationTargetPath("/chat/cm123")).toBe("/chat/cm123");
    expect(safeNotificationTargetPath("/projects/cm123")).toBe("/projects/cm123");
    expect(safeNotificationTargetPath("  /usage  ")).toBe("/usage");

    expect(safeNotificationTargetPath("//evil.example.com")).toBeNull();
    expect(safeNotificationTargetPath("https://evil.example.com")).toBeNull();
    expect(safeNotificationTargetPath("/chat/../../etc/passwd")).toBeNull();
    expect(safeNotificationTargetPath("/admin/users")).toBeNull();
    expect(safeNotificationTargetPath("/chat/1?x=2")).toBeNull();
    expect(safeNotificationTargetPath("/chat/1#frag")).toBeNull();
    expect(safeNotificationTargetPath("/chat\\1")).toBeNull();
    expect(safeNotificationTargetPath("")).toBeNull();
    expect(safeNotificationTargetPath(null)).toBeNull();
    expect(safeNotificationTargetPath(undefined)).toBeNull();
    expect(safeNotificationTargetPath(`/chat/${"a".repeat(600)}`)).toBeNull();
  });

  it("识别通知类型，未知类型降级为已完成而不是抛错", () => {
    expect(isNotificationKind("failed")).toBe(true);
    expect(isNotificationKind("weird")).toBe(false);
    expect(
      toNotificationDto({
        id: "n1",
        taskType: "agent_execution",
        taskId: "exec-1",
        kind: "weird",
        title: "标题",
        summary: null,
        targetPath: "//evil.example.com",
        createdAt: new Date("2026-09-08T10:00:00.000Z"),
        readAt: null,
        toastAcknowledgedAt: null,
      })
    ).toMatchObject({
      kind: "completed",
      targetPath: null,
      createdAt: "2026-09-08T10:00:00.000Z",
      readAt: null,
    });
  });

  it("分页大小受限", () => {
    expect(normalizeNotificationLimit(undefined)).toBe(NOTIFICATION_PAGE_SIZE);
    expect(normalizeNotificationLimit(0)).toBe(1);
    expect(normalizeNotificationLimit(500)).toBe(50);
  });
});
