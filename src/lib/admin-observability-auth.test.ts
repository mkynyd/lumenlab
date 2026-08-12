import { describe, expect, it } from "vitest";
import {
  adminObservabilitySignature,
  isAdminObservabilityTimestampFresh,
  verifyAdminObservabilitySignature,
} from "./admin-observability-auth";

describe("admin observability request authentication", () => {
  const request = {
    method: "GET",
    path: "/api/internal/admin-observability?action=overview",
    body: "",
    timestamp: "1786532400000",
    nonce: "nonce_1234567890123456",
    secret: "separate-observability-secret",
  };

  it("signs method, full path and body", () => {
    const signature = adminObservabilitySignature(request);
    expect(verifyAdminObservabilitySignature({ ...request, signature })).toBe(true);
    expect(
      verifyAdminObservabilitySignature({
        ...request,
        path: `${request.path}&range=90`,
        signature,
      })
    ).toBe(false);
  });

  it("rejects malformed signatures and nonces", () => {
    expect(
      verifyAdminObservabilitySignature({
        ...request,
        nonce: "short",
        signature: "not-hex",
      })
    ).toBe(false);
  });

  it("accepts timestamps only inside the five minute window", () => {
    expect(isAdminObservabilityTimestampFresh(request.timestamp, 1786532400000)).toBe(true);
    expect(isAdminObservabilityTimestampFresh(request.timestamp, 1786532700001)).toBe(false);
  });
});
