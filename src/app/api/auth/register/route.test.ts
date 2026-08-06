import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { registrationRepository } = vi.hoisted(() => ({
  registrationRepository: {
    findUserByEmail: vi.fn(),
    findChallengeForTicket: vi.fn(),
    consumeTicket: vi.fn(),
    findDefaultCredentialProfile: vi.fn(),
    createUser: vi.fn(),
    completeChallenge: vi.fn(),
    transaction: vi.fn(),
  },
}));

const { checkRateLimit } = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));

vi.mock("@/lib/data/registration-repository", () => ({
  registrationRepository,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit,
  RateLimits: { REGISTER: { max: 3, window: 60_000 } },
}));

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-password") },
}));

import { sha256 } from "@/lib/auth-challenge";
import { POST } from "./route";

const RAW_TICKET = "rawTicketRawTicketRawTicketRawTicketRawTicketRa";
const TICKET_HASH = sha256(RAW_TICKET);

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    checkRateLimit.mockReset().mockResolvedValue({ allowed: true });
    registrationRepository.transaction
      .mockReset()
      .mockImplementation(async (operation: (repo: typeof registrationRepository) => unknown) =>
        operation(registrationRepository)
      );
    registrationRepository.findUserByEmail.mockReset().mockResolvedValue(null);
    registrationRepository.findChallengeForTicket.mockReset().mockResolvedValue({
      id: "challenge-1",
      email: "new@example.com",
      verifiedAt: new Date("2026-08-06T11:50:00.000Z"),
      verifiedVia: "code",
      ticketHash: TICKET_HASH,
      ticketExpiresAt: new Date("2026-08-06T12:15:00.000Z"),
      ticketConsumedAt: null,
      consumedAt: null,
    });
    registrationRepository.consumeTicket.mockReset().mockResolvedValue(true);
    registrationRepository.findDefaultCredentialProfile
      .mockReset()
      .mockResolvedValue({ id: "profile-1" });
    registrationRepository.createUser.mockReset().mockResolvedValue({
      id: "user-1",
      email: "new@example.com",
      name: null,
    });
    registrationRepository.completeChallenge
      .mockReset()
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a verified user with a consumed ticket and default profile", async () => {
    const response = await POST(
      makeRequest({
        email: "new@example.com",
        password: "password123",
        ticket: `challenge-1.${RAW_TICKET}`,
      })
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      user: { id: "user-1", email: "new@example.com", name: null },
    });
    expect(registrationRepository.consumeTicket).toHaveBeenCalled();
    expect(registrationRepository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@example.com",
        credentialProfileId: "profile-1",
        emailVerificationSource: "code",
      })
    );
  });

  it("returns 429 when rate limited", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false });

    const response = await POST(
      makeRequest({
        email: "new@example.com",
        password: "password123",
        ticket: "challenge-1.raw",
      })
    );

    expect(response.status).toBe(429);
  });

  it("returns 409 for an already-registered email", async () => {
    registrationRepository.findUserByEmail
      .mockReset()
      .mockResolvedValue({ id: "existing" });

    const response = await POST(
      makeRequest({
        email: "new@example.com",
        password: "password123",
        ticket: "challenge-1.raw",
      })
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toEqual({
      email: ["该邮箱已被注册"],
    });
  });

  it("returns 400 with a ticket-field error for an invalid ticket", async () => {
    registrationRepository.findChallengeForTicket
      .mockReset()
      .mockResolvedValue(null);

    const response = await POST(
      makeRequest({
        email: "new@example.com",
        password: "password123",
        ticket: "missing-challenge.raw",
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toEqual({
      ticket: ["验证已失效，请重新验证邮箱"],
    });
  });

  it("returns 503 when no default credential profile is available", async () => {
    registrationRepository.findDefaultCredentialProfile
      .mockReset()
      .mockResolvedValue(null);

    const response = await POST(
      makeRequest({
        email: "new@example.com",
        password: "password123",
        ticket: `challenge-1.${RAW_TICKET}`,
      })
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("注册服务暂不可用，请稍后再试");
  });

  it("returns 400 for invalid input", async () => {
    const response = await POST(makeRequest({ email: "not-an-email" }));

    expect(response.status).toBe(400);
  });
});
