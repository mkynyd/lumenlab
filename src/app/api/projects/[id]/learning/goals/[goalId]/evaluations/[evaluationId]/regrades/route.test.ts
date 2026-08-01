// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  regradeEvaluation: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/learning/feature-flags", () => ({
  learningFeatureFlags: { apiEnabled: true },
}));
vi.mock("@/lib/learning/services", () => ({
  learningService: {
    regradeEvaluation: mocks.regradeEvaluation,
  },
}));

import { POST } from "./route";

const context = {
  params: Promise.resolve({
    id: "project-1",
    goalId: "goal-1",
    evaluationId: "evaluation-1",
  }),
};

describe("POST learning regrade route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.regradeEvaluation.mockResolvedValue({
      regrade: {
        id: "regrade-1",
        attemptId: "attempt-1",
        verdict: "correct",
        score: 1,
        confidence: 1,
        errorType: null,
        reason: "判定有误",
        policyVersion: "manual-regrade-v1",
        supersedesEvaluationId: "evaluation-1",
        createdAt: "2026-08-01T08:00:00.000Z",
      },
      progress: [],
    });
  });

  it("rejects invalid verdicts and unknown fields", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          verdict: "maybe",
          reason: "判定有误",
          idempotencyKey: "regrade-1",
          userId: "other-user",
        }),
      }),
      context
    );

    expect(response.status).toBe(400);
    expect(mocks.regradeEvaluation).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          verdict: "correct",
          idempotencyKey: "regrade-1",
        }),
      }),
      context
    );

    expect(response.status).toBe(400);
    expect(mocks.regradeEvaluation).not.toHaveBeenCalled();
  });

  it("takes ownership ids from the authenticated path only", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          verdict: "correct",
          errorType: "misconception",
          reason: "判定有误，应为正确",
          idempotencyKey: "regrade-1",
        }),
      }),
      context
    );

    expect(response.status).toBe(201);
    expect(mocks.regradeEvaluation).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "project-1",
      goalId: "goal-1",
      evaluationId: "evaluation-1",
      input: {
        verdict: "correct",
        errorType: "misconception",
        reason: "判定有误，应为正确",
        idempotencyKey: "regrade-1",
      },
    });
  });
});
