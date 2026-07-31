import { describe, expect, it } from "vitest";

import { AgentExecutionRetryPolicy } from "./retry-policy";

describe("AgentExecutionRetryPolicy", () => {
  it("uses bounded exponential backoff before the final attempt", () => {
    const policy = new AgentExecutionRetryPolicy({
      maxAttempts: 5,
      baseDelayMs: 1_000,
      maxDelayMs: 5_000,
    });
    const now = new Date("2026-07-31T00:00:00.000Z");

    expect(policy.decide({ attempt: 1, now })).toEqual({
      action: "retry",
      delayMs: 1_000,
      scheduledAt: new Date("2026-07-31T00:00:01.000Z"),
    });
    expect(policy.decide({ attempt: 4, now })).toEqual({
      action: "retry",
      delayMs: 5_000,
      scheduledAt: new Date("2026-07-31T00:00:05.000Z"),
    });
  });

  it("poisons a run once its current attempt reaches the limit", () => {
    const policy = new AgentExecutionRetryPolicy({
      maxAttempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
    });

    expect(
      policy.decide({
        attempt: 3,
        now: new Date("2026-07-31T00:00:00.000Z"),
      })
    ).toEqual({ action: "fail" });
  });

  it("rejects invalid retry settings instead of creating a hot loop", () => {
    expect(
      () =>
        new AgentExecutionRetryPolicy({
          maxAttempts: 0,
          baseDelayMs: 1_000,
          maxDelayMs: 30_000,
        })
    ).toThrow("maxAttempts must be a positive integer");
    expect(
      () =>
        new AgentExecutionRetryPolicy({
          maxAttempts: 3,
          baseDelayMs: 0,
          maxDelayMs: 30_000,
        })
    ).toThrow("baseDelayMs must be a positive finite number");
  });
});
