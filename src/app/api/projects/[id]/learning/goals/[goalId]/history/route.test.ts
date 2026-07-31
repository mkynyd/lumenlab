// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getHistory: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/learning/feature-flags", () => ({
  learningFeatureFlags: { apiEnabled: true },
}));
vi.mock("@/lib/learning/services", () => ({
  learningService: { getHistory: mocks.getHistory },
}));

import { GET } from "./route";

describe("GET learning history route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getHistory.mockResolvedValue({
      goal: { id: "goal-1", title: "复习电路" },
      summary: { attempts: 1 },
      points: [],
    });
  });

  it("uses authenticated project and goal ownership inputs", async () => {
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "project-1", goalId: "goal-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.getHistory).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "project-1",
      goalId: "goal-1",
    });
    await expect(response.json()).resolves.toMatchObject({
      history: { goal: { id: "goal-1" }, points: [] },
    });
  });
});
