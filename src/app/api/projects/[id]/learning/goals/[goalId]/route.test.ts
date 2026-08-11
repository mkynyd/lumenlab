// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

import { LearningServiceError } from "@/lib/learning/contracts";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getGoal: vi.fn(),
  updateGoalStatus: vi.fn(),
  deleteGoal: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/learning/feature-flags", () => ({
  learningFeatureFlags: { apiEnabled: true },
}));
vi.mock("@/lib/learning/services", () => ({
  learningService: {
    getGoal: mocks.getGoal,
    updateGoalStatus: mocks.updateGoalStatus,
    deleteGoal: mocks.deleteGoal,
  },
}));

import { DELETE } from "./route";

const context = {
  params: Promise.resolve({ id: "project-1", goalId: "goal-1" }),
};

describe("DELETE learning goal route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.deleteGoal.mockResolvedValue(undefined);
  });

  it("rejects anonymous requests with 401", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      context
    );

    expect(response.status).toBe(401);
    expect(mocks.deleteGoal).not.toHaveBeenCalled();
  });

  it("forwards ownership ids and returns success", async () => {
    const response = await DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      context
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.deleteGoal).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "project-1",
      goalId: "goal-1",
    });
  });

  it("maps ownership failures to 404", async () => {
    mocks.deleteGoal.mockRejectedValue(
      new LearningServiceError("not_found", "学习目标不存在", 404)
    );

    const response = await DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      context
    );

    expect(response.status).toBe(404);
  });
});
