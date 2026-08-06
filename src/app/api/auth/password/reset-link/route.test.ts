import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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

import { sha256 } from "@/lib/auth-challenge";
import { GET } from "./route";

const RAW = "rawTokenRawTokenRawTokenRawTokenRawTokenRawTok";
const TOKEN = `challenge-1.${RAW}`;

describe("GET /api/auth/password/reset-link", () => {
  beforeEach(() => {
    passwordResetRepository.findResetToken.mockReset().mockResolvedValue({
      email: "user@example.com",
      tokenHash: sha256(RAW),
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      tokenConsumedAt: null,
      consumedAt: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates without consuming and redirects with the original token", async () => {
    const request = new NextRequest(
      `http://localhost/api/auth/password/reset-link?token=${TOKEN}`
    );
    const response = await GET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location") || "";
    expect(location).toContain("/reset-password?ticket=challenge-1.");
    // GET 只校验不消费
    expect(passwordResetRepository.claimResetToken).not.toHaveBeenCalled();
  });

  it("redirects to the invalid marker for a wrong token", async () => {
    passwordResetRepository.findResetToken.mockResolvedValue({
      email: "user@example.com",
      tokenHash: sha256("other"),
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      tokenConsumedAt: null,
      consumedAt: null,
    });

    const request = new NextRequest(
      `http://localhost/api/auth/password/reset-link?token=${TOKEN}`
    );
    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain(
      "/reset-password?invalid=1"
    );
  });

  it("redirects to the invalid marker for a consumed token", async () => {
    passwordResetRepository.findResetToken.mockResolvedValue({
      email: "user@example.com",
      tokenHash: sha256(RAW),
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      tokenConsumedAt: new Date(),
      consumedAt: null,
    });

    const request = new NextRequest(
      `http://localhost/api/auth/password/reset-link?token=${TOKEN}`
    );
    const response = await GET(request);

    expect(response.headers.get("location")).toContain("/reset-password?invalid=1");
  });
});
