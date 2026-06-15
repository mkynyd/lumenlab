import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  digestRegistrationCode,
  evaluateRegistrationCode,
  normalizeRegistrationCode,
} from "@/lib/registration-code";

describe("normalizeRegistrationCode", () => {
  it("normalizes case, spaces, and separators", () => {
    expect(normalizeRegistrationCode(" alpha-7x 9p ")).toBe("ALPHA7X9P");
  });
});

describe("digestRegistrationCode", () => {
  it("uses an HMAC digest instead of a reversible or plain hash value", () => {
    const digest = digestRegistrationCode("alpha-7x9p", "test-pepper");
    const expected = createHmac("sha256", "test-pepper")
      .update("ALPHA7X9P")
      .digest("hex");

    expect(digest).toBe(expected);
    expect(digest).not.toContain("ALPHA7X9P");
  });
});

describe("evaluateRegistrationCode", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("accepts an active code with remaining redemptions", () => {
    expect(
      evaluateRegistrationCode(
        {
          status: "active",
          redemptionCount: 2,
          maxRedemptions: 5,
          expiresAt: null,
        },
        now
      )
    ).toEqual({ allowed: true });
  });

  it.each([
    ["disabled", 0, 5, null, "disabled"],
    ["active", 5, 5, null, "exhausted"],
    [
      "active",
      0,
      5,
      new Date("2026-06-15T11:59:59.000Z"),
      "expired",
    ],
  ] as const)(
    "rejects unusable codes",
    (status, redemptionCount, maxRedemptions, expiresAt, reason) => {
      expect(
        evaluateRegistrationCode(
          { status, redemptionCount, maxRedemptions, expiresAt },
          now
        )
      ).toEqual({ allowed: false, reason });
    }
  );
});

