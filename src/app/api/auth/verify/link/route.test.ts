import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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

import { GET } from "./route";

describe("GET /api/auth/verify/link", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_URL", "https://lab.mkynstudio.top");
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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("redirects to the register page with the issued ticket", async () => {
    const { sha256 } = await import("@/lib/auth-challenge");
    const now = new Date();
    authChallengeRepository.findToken.mockResolvedValue({
      email: "new@example.com",
      type: "verify",
      tokenHash: sha256("rawTokenPart"),
      tokenExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      tokenConsumedAt: null,
      verifiedAt: null,
      consumedAt: null,
    });

    const request = new NextRequest(
      "https://localhost:3000/api/auth/verify/link?token=challenge-1.rawTokenPart"
    );
    const response = await GET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location") || "";
    expect(location).toMatch(/^https:\/\/lab\.mkynstudio\.top\/register\?/);
    expect(location).not.toContain("localhost");
    expect(location).toContain("verified=1");
    expect(location).toContain("ticket=challenge-1.");
    expect(location).toContain("email=new%40example.com");
    expect(authChallengeRepository.markTokenVerified).toHaveBeenCalled();
  });

  it("redirects to the failed marker for an invalid token", async () => {
    authChallengeRepository.findToken.mockResolvedValue(null);

    const request = new NextRequest(
      "http://localhost/api/auth/verify/link?token=challenge-1.wrong"
    );
    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://lab.mkynstudio.top/register?verify=failed"
    );
    expect(authChallengeRepository.markTokenVerified).not.toHaveBeenCalled();
  });
});
