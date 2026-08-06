import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { checkRateLimit } = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit,
  RateLimits: { PASSWORD_RESET_IP: { max: 5, window: 600_000 } },
}));

const { passwordResetRepository } = vi.hoisted(() => ({
  passwordResetRepository: {
    findResetToken: vi.fn(),
    claimResetToken: vi.fn(),
    findUserByEmail: vi.fn(),
    updatePassword: vi.fn(),
    transaction: vi.fn(),
  },
}));
vi.mock("@/lib/data/password-reset-repository", () => ({
  passwordResetRepository,
}));

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-new-password") },
}));

import { sha256 } from "@/lib/auth-challenge";
import { POST } from "./route";

const RAW = "rawTokenRawTokenRawTokenRawTokenRawTokenRawTok";
const TICKET = `challenge-1.${RAW}`;

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/auth/password/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/password/reset", () => {
  beforeEach(() => {
    checkRateLimit.mockReset().mockResolvedValue({ allowed: true });
    passwordResetRepository.findResetToken.mockReset().mockResolvedValue({
      email: "user@example.com",
      tokenHash: sha256(RAW),
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      tokenConsumedAt: null,
      consumedAt: null,
    });
    passwordResetRepository.claimResetToken.mockReset().mockResolvedValue(true);
    passwordResetRepository.findUserByEmail
      .mockReset()
      .mockResolvedValue({ id: "user-1" });
    passwordResetRepository.updatePassword
      .mockReset()
      .mockResolvedValue(undefined);
    passwordResetRepository.transaction
      .mockReset()
      .mockImplementation(async (operation: (repo: unknown) => unknown) =>
        operation(passwordResetRepository)
      );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resets the password and claims the token", async () => {
    const response = await POST(
      makeRequest({ ticket: TICKET, password: "new-password-123" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(passwordResetRepository.claimResetToken).toHaveBeenCalled();
    expect(passwordResetRepository.updatePassword).toHaveBeenCalledWith(
      "user-1",
      "hashed-new-password",
      expect.any(Date)
    );
  });

  it("returns 429 when rate limited", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false });

    const response = await POST(
      makeRequest({ ticket: TICKET, password: "new-password-123" })
    );

    expect(response.status).toBe(429);
  });

  it("returns a ticket-field error for an invalid token", async () => {
    passwordResetRepository.findResetToken.mockResolvedValue(null);

    const response = await POST(
      makeRequest({ ticket: TICKET, password: "new-password-123" })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual({
      ticket: ["重设链接无效，请重新申请"],
    });
  });

  it("returns a ticket-field error for an expired token", async () => {
    passwordResetRepository.findResetToken.mockResolvedValue({
      email: "user@example.com",
      tokenHash: sha256(RAW),
      tokenExpiresAt: new Date(Date.now() - 1000),
      tokenConsumedAt: null,
      consumedAt: null,
    });

    const response = await POST(
      makeRequest({ ticket: TICKET, password: "new-password-123" })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual({
      ticket: ["重设链接已过期，请重新申请"],
    });
  });

  it("returns 400 for invalid input", async () => {
    const response = await POST(makeRequest({ ticket: "x", password: "short" }));

    expect(response.status).toBe(400);
  });
});
