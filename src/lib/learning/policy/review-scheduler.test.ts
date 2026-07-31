import { describe, expect, it } from "vitest";

import type { LearningClock } from "../contracts";
import { scheduleReview } from "./index";

const now = new Date("2026-07-31T08:00:00.000Z");
const clock: LearningClock = {
  now: () => new Date(now),
};

describe("scheduleReview", () => {
  it("keeps mastery separate from review due state", () => {
    const result = scheduleReview(
      {
        masteryState: "mastered",
        verdict: "correct",
        assistanceLevel: "independent",
        spacingSeconds: 2 * 24 * 60 * 60,
        freshness: "current",
        successfulReviewCount: 2,
      },
      clock,
    );

    expect(result).toMatchObject({
      policyVersion: "review-v1",
      reviewState: "scheduled",
      reason: "independent_success",
    });
    expect(result.nextReviewAt?.getTime()).toBeGreaterThan(now.getTime());
    expect(result.intervalSeconds).toBeGreaterThanOrEqual(7 * 24 * 60 * 60);
  });

  it("makes revalidation due now without erasing mastery", () => {
    const result = scheduleReview(
      {
        masteryState: "mastered",
        verdict: "correct",
        assistanceLevel: "independent",
        spacingSeconds: 24 * 60 * 60,
        freshness: "needs_revalidation",
        successfulReviewCount: 5,
      },
      clock,
    );

    expect(result).toEqual({
      policyVersion: "review-v1",
      reviewState: "due",
      nextReviewAt: now,
      intervalSeconds: 0,
      reason: "needs_revalidation",
    });
  });

  it("leaves unsupported material unscheduled", () => {
    expect(
      scheduleReview(
        {
          masteryState: "learning",
          verdict: "incorrect",
          assistanceLevel: "independent",
          spacingSeconds: 0,
          freshness: "unsupported",
          successfulReviewCount: 0,
        },
        clock,
      ),
    ).toEqual({
      policyVersion: "review-v1",
      reviewState: "unscheduled",
      nextReviewAt: null,
      intervalSeconds: null,
      reason: "unsupported",
    });
  });

  it("schedules failures sooner than assisted and independent successes", () => {
    const incorrect = scheduleReview(
      {
        masteryState: "learning",
        verdict: "incorrect",
        assistanceLevel: "independent",
        spacingSeconds: 0,
        freshness: "current",
        successfulReviewCount: 0,
      },
      clock,
    );
    const assisted = scheduleReview(
      {
        masteryState: "learning",
        verdict: "correct",
        assistanceLevel: "answer_exposed",
        spacingSeconds: 30,
        freshness: "current",
        successfulReviewCount: 0,
      },
      clock,
    );
    const independent = scheduleReview(
      {
        masteryState: "learning",
        verdict: "correct",
        assistanceLevel: "independent",
        spacingSeconds: 30,
        freshness: "current",
        successfulReviewCount: 0,
      },
      clock,
    );

    expect(incorrect.reason).toBe("incorrect");
    expect(assisted.reason).toBe("assisted_success");
    expect(independent.reason).toBe("independent_success");
    expect(incorrect.intervalSeconds).toBeLessThan(
      assisted.intervalSeconds ?? Infinity,
    );
    expect(assisted.intervalSeconds).toBeLessThan(
      independent.intervalSeconds ?? Infinity,
    );
  });
});
