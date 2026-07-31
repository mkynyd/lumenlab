// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  correctEvaluationErrorType: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/learning/feature-flags", () => ({
  learningFeatureFlags: { apiEnabled: true },
}));
vi.mock("@/lib/learning/services", () => ({
  learningService: {
    correctEvaluationErrorType: mocks.correctEvaluationErrorType,
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

describe("POST learning error-type correction route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.correctEvaluationErrorType.mockResolvedValue({
      correction: {
        id: "correction-1",
        evaluationId: "evaluation-1",
        errorType: "misconception",
      },
    });
  });

  it("rejects unknown error types and extra fields", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          errorType: "personality_trait",
          idempotencyKey: "correction-1",
          userId: "other-user",
        }),
      }),
      context
    );

    expect(response.status).toBe(400);
    expect(mocks.correctEvaluationErrorType).not.toHaveBeenCalled();
  });

  it("takes ownership ids from the authenticated path only", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          errorType: "misconception",
          reason: "我把两个概念混在了一起",
          idempotencyKey: "correction-1",
        }),
      }),
      context
    );

    expect(response.status).toBe(201);
    expect(mocks.correctEvaluationErrorType).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "project-1",
      goalId: "goal-1",
      evaluationId: "evaluation-1",
      input: {
        errorType: "misconception",
        reason: "我把两个概念混在了一起",
        idempotencyKey: "correction-1",
      },
    });
  });
});
