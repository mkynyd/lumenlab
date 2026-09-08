import { describe, expect, it } from "vitest";

import {
  DEFAULT_ACTIVE_TASK_LIMIT,
  MAX_ACTIVE_TASK_LIMIT,
  TASK_STATUS_LABELS,
  isActiveTaskStatus,
  isTaskStatus,
  normalizeTaskLimit,
  taskProgressLabel,
} from "./contracts";

describe("任务合同", () => {
  it("识别任务状态并区分进行中与终态", () => {
    expect(isTaskStatus("waiting_user")).toBe(true);
    expect(isTaskStatus("unknown")).toBe(false);
    expect(isActiveTaskStatus("queued")).toBe(true);
    expect(isActiveTaskStatus("running")).toBe(true);
    expect(isActiveTaskStatus("waiting_user")).toBe(true);
    expect(isActiveTaskStatus("completed")).toBe(false);
    expect(isActiveTaskStatus("failed")).toBe(false);
    expect(isActiveTaskStatus("cancelled")).toBe(false);
  });

  it("限制任务数量参数", () => {
    expect(normalizeTaskLimit(undefined)).toBe(DEFAULT_ACTIVE_TASK_LIMIT);
    expect(normalizeTaskLimit(0)).toBe(1);
    expect(normalizeTaskLimit(-3)).toBe(1);
    expect(normalizeTaskLimit(3.9)).toBe(3);
    expect(normalizeTaskLimit(999)).toBe(MAX_ACTIVE_TASK_LIMIT);
    expect(normalizeTaskLimit(Number.NaN)).toBe(DEFAULT_ACTIVE_TASK_LIMIT);
  });

  it("有总量时给出已完成比例，无总量时只给阶段", () => {
    expect(
      taskProgressLabel({ stage: "正在执行工具", completedUnits: 2, totalUnits: 5 })
    ).toBe("正在执行工具 · 2/5");
    expect(
      taskProgressLabel({ stage: null, completedUnits: 2, totalUnits: 5 })
    ).toBe("2/5");
    expect(
      taskProgressLabel({ stage: "正在执行工具", completedUnits: 2, totalUnits: null })
    ).toBe("正在执行工具 · 已完成 2 项");
    expect(
      taskProgressLabel({ stage: "排队等待执行", completedUnits: 0, totalUnits: null })
    ).toBe("排队等待执行");
    expect(taskProgressLabel({ stage: null, completedUnits: null, totalUnits: null })).toBe(
      "进行中"
    );
    // 已完成为负数或超过总量时按边界收敛，不输出负数或超额。
    expect(
      taskProgressLabel({ stage: "阶段", completedUnits: -1, totalUnits: 3 })
    ).toBe("阶段 · 0/3");
    expect(
      taskProgressLabel({ stage: "阶段", completedUnits: 9, totalUnits: 3 })
    ).toBe("阶段 · 3/3");
  });

  it("每个状态都有用户可见文案", () => {
    expect(TASK_STATUS_LABELS.waiting_user).toBe("等待你的确认");
    expect(TASK_STATUS_LABELS.completed).toBe("已完成");
  });
});
