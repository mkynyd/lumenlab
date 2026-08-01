// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  reviseGoal: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/learning/feature-flags", () => ({
  learningFeatureFlags: { apiEnabled: true },
}));
vi.mock("@/lib/learning/services", () => ({
  learningService: {
    reviseGoal: mocks.reviseGoal,
  },
}));

import { POST } from "./route";

const context = {
  params: Promise.resolve({ id: "project-1", goalId: "goal-1" }),
};

describe("POST learning goal revision route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.reviseGoal.mockResolvedValue({
      goal: {
        id: "goal-1",
        title: "电路基础进阶",
      },
      revision: {
        id: "revision-1",
        goalId: "goal-1",
        title: "电路基础进阶",
        purpose: null,
        targetDate: null,
        dailyMinutes: null,
        reason: "目标调整",
        createdAt: "2026-08-01T08:00:00.000Z",
      },
    });
  });

  it("requires a reason", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          title: "电路基础进阶",
          idempotencyKey: "revision-1",
        }),
      }),
      context
    );

    expect(response.status).toBe(400);
    expect(mocks.reviseGoal).not.toHaveBeenCalled();
  });

  it("forwards a revision command to the service", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          title: "电路基础进阶",
          purpose: "准备期末考试",
          targetDate: "2026-09-01T00:00:00.000Z",
          dailyMinutes: 45,
          reason: "目标调整",
          idempotencyKey: "revision-1",
        }),
      }),
      context
    );

    expect(response.status).toBe(201);
    expect(mocks.reviseGoal).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "project-1",
      goalId: "goal-1",
      input: {
        title: "电路基础进阶",
        purpose: "准备期末考试",
        targetDate: "2026-09-01T00:00:00.000Z",
        dailyMinutes: 45,
        reason: "目标调整",
        idempotencyKey: "revision-1",
      },
    });
  });
});
