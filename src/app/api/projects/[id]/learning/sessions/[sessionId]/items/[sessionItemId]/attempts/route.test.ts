// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  submitAttempt: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/learning/feature-flags", () => ({
  learningFeatureFlags: {
    apiEnabled: true,
  },
}));
vi.mock("@/lib/learning/services", () => ({
  learningService: {
    submitAttempt: mocks.submitAttempt,
  },
}));

import { POST } from "./route";

const context = {
  params: Promise.resolve({
    id: "project-1",
    sessionId: "session-1",
    sessionItemId: "session-item-1",
  }),
};

describe("POST learning attempt route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.submitAttempt.mockResolvedValue({
      attempt: { id: "attempt-1" },
      evaluation: { id: "evaluation-1", verdict: "correct" },
      progress: [],
      feedback: { explanation: "提交后反馈" },
    });
  });

  it("rejects client-authored assistance facts", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: "attempt-1",
          answer: true,
          assistanceLevel: "independent",
        }),
      }),
      context
    );

    expect(response.status).toBe(400);
    expect(mocks.submitAttempt).not.toHaveBeenCalled();
  });

  it("takes idempotency only from the strict body and scopes path ownership", async () => {
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: {
          "Idempotency-Key": "ignored-header-key",
        },
        body: JSON.stringify({
          idempotencyKey: "body-key",
          answer: true,
        }),
      }),
      context
    );

    expect(response.status).toBe(201);
    expect(mocks.submitAttempt).toHaveBeenCalledWith({
      userId: "user-1",
      projectId: "project-1",
      sessionId: "session-1",
      sessionItemId: "session-item-1",
      input: {
        idempotencyKey: "body-key",
        answer: true,
      },
    });
  });
});
