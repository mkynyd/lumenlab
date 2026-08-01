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

describe("POST user-wide profile reset route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.resetProfile.mockResolvedValue({
      reset: {
        id: "reset-1",
        scope: { kind: "user" },
        reason: "全部重新开始",
        createdAt: "2026-08-01T08:00:00.000Z",
        affectedPointCount: 12,
      },
    });
  });

  it("rejects goal or point scopes on the user route", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          scope: { kind: "goal", goalId: "goal-1" },
          reason: "重新开始",
          idempotencyKey: "reset-1",
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.resetProfile).not.toHaveBeenCalled();
  });

  it("forwards user-scoped resets without a project context", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          scope: { kind: "user" },
          reason: "全部重新开始",
          idempotencyKey: "reset-1",
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.resetProfile).toHaveBeenCalledWith({
      userId: "user-1",
      input: {
        scope: { kind: "user" },
        reason: "全部重新开始",
        idempotencyKey: "reset-1",
      },
    });
  });
});
