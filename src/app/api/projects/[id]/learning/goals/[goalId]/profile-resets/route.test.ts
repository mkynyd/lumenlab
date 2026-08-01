// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resetProfile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/learning/feature-flags", () => ({
  learningFeatureFlags: { apiEnabled: true },
}));
vi.mock("@/lib/learning/services", () => ({
  learningService: {
    resetProfile: mocks.resetProfile,
  },
}));

import { POST } from "./route";

const context = {
  params: Promise.resolve({ id: "project-1", goalId: "goal-1" }),
};

describe("POST goal profile reset route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.resetProfile.mockResolvedValue({
      reset: {
        id: "reset-1",
        scope: { kind: "goal", goalId: "goal-1" },
        reason: "重新开始",
        createdAt: "2026-08-01T08:00:00.000Z",
        affectedPointCount: 3,
      },
    });
  });

  it("rejects user-scoped resets on the goal route", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          scope: { kind: "user" },
          idempotencyKey: "reset-1",
        }),
      }),
      context
    );

    expect(response.status).toBe(400);
    expect(mocks.resetProfile).not.toHaveBeenCalled();
  });

  it("rejects resets for a different goal than the route", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          scope: { kind: "goal", goalId: "goal-2" },
          reason: "重新开始",
          idempotencyKey: "reset-1",
        }),
      }),
      context
    );

    expect(response.status).toBe(400);
    expect(mocks.resetProfile).not.toHaveBeenCalled();
  });

  it("forwards goal and point resets with the route project context", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          scope: { kind: "point", goalId: "goal-1", lineageId: "lineage-1" },
          reason: "只重置这个知识点",
          idempotencyKey: "reset-1",
        }),
      }),
      context
    );

    expect(response.status).toBe(201);
    expect(mocks.resetProfile).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "project-1",
      input: {
        scope: {
          kind: "point",
          goalId: "goal-1",
          lineageId: "lineage-1",
        },
        reason: "只重置这个知识点",
        idempotencyKey: "reset-1",
      },
    });
  });
});
