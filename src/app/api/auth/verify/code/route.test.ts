import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { checkRateLimit } = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit,
  RateLimits: { VERIFY_CODE_IP: { max: 10, window: 900_000 } },
}));

const { authChallengeRepository } = vi.hoisted(() => ({
  authChallengeRepository: {
    invalidateActiveChallenges: vi.fn(),
    createChallenge: vi.fn(),
    findActiveByEmail: vi.fn(),
    incrementCodeAttempt: vi.fn(),
    markCodeVerified: vi.fn(),
    findToken: vi.fn(),
    markTokenVerified: vi.fn(),
    findChallengeForTicket: vi.fn(),
    consumeTicket: vi.fn(),
    completeChallenge: vi.fn(),
  },
}));
vi.mock("@/lib/data/auth-challenge-repository", () => ({
  authChallengeRepository,
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/auth/verify/code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/verify/code", () => {
  beforeEach(() => {
    checkRateLimit.mockReset().mockResolvedValue({ allowed: true });
    authChallengeRepository.invalidateActiveChallenges
      .mockReset()
      .mockResolvedValue(undefined);
    authChallengeRepository.createChallenge
      .mockReset()
      .mockResolvedValue({ id: "challenge-1" });
    authChallengeRepository.findActiveByEmail.mockReset().mockResolvedValue(null);
    authChallengeRepository.incrementCodeAttempt
      .mockReset()
      .mockResolvedValue(true);
    authChallengeRepository.markCodeVerified
      .mockReset()
      .mockResolvedValue(true);
    authChallengeRepository.findToken.mockReset().mockResolvedValue(null);
    authChallengeRepository.markTokenVerified
      .mockReset()
      .mockResolvedValue(true);
    authChallengeRepository.findChallengeForTicket
      .mockReset()
      .mockResolvedValue(null);
    authChallengeRepository.consumeTicket.mockReset().mockResolvedValue(true);
    authChallengeRepository.completeChallenge
      .mockReset()
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a ticket when the code verifies", async () => {
    // 构造一个可被 verifyWithCode 成功消费的挑战
    const { sha256 } = await import("@/lib/auth-challenge");
    const now = new Date();
    authChallengeRepository.findActiveByEmail.mockResolvedValue({
      id: "challenge-1",
      email: "new@example.com",
      type: "verify",
      userId: null,
      codeHash: sha256("123456"),
      codeExpiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      codeAttempts: 0,
      verifiedAt: null,
      consumedAt: null,
    });

    const response = await POST(
      makeRequest({ email: "new@example.com", code: "123456" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.ticket).toMatch(/^challenge-1\.[A-Za-z0-9_-]+$/);
    expect(authChallengeRepository.markCodeVerified).toHaveBeenCalled();
  });

  it("returns a field error for a wrong code", async () => {
    const { sha256 } = await import("@/lib/auth-challenge");
    const now = new Date();
    authChallengeRepository.findActiveByEmail.mockResolvedValue({
      id: "challenge-1",
      email: "new@example.com",
      type: "verify",
      userId: null,
      codeHash: sha256("654321"),
      codeExpiresAt: new Date(now.getTime() + 15 * 60 * 1000),
      codeAttempts: 0,
      verifiedAt: null,
      consumedAt: null,
    });

    const response = await POST(
      makeRequest({ email: "new@example.com", code: "123456" })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual({ code: ["验证码错误"] });
  });

  it("returns 429 when rate limited", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false });

    const response = await POST(
      makeRequest({ email: "new@example.com", code: "123456" })
    );

    expect(response.status).toBe(429);
  });

  it("returns 400 for invalid input", async () => {
    const response = await POST(makeRequest({ email: "x@y.com", code: "12" }));

    expect(response.status).toBe(400);
  });
});
