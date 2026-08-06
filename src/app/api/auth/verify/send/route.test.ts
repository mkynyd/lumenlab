import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prisma } = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ prisma }));

const { sendVerificationEmail } = vi.hoisted(() => ({
  sendVerificationEmail: vi.fn(),
}));
vi.mock("@/lib/email/service", () => ({ sendVerificationEmail }));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/auth/verify/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/verify/send", () => {
  beforeEach(() => {
    prisma.user.findUnique.mockReset().mockResolvedValue(null);
    sendVerificationEmail.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a verification email and reports resendAfter", async () => {
    const response = await POST(makeRequest({ email: "new@example.com" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, resendAfter: 60 });
    expect(sendVerificationEmail).toHaveBeenCalledWith({
      email: "new@example.com",
      ip: "unknown",
    });
  });

  it("returns 409 when the email is already registered", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "existing" });

    const response = await POST(makeRequest({ email: "taken@example.com" }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toEqual({
      email: ["该邮箱已被注册"],
    });
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited", async () => {
    sendVerificationEmail.mockResolvedValue({
      ok: false,
      reason: "rate_limited",
    });

    const response = await POST(makeRequest({ email: "new@example.com" }));

    expect(response.status).toBe(429);
  });

  it("returns 500 when the send fails", async () => {
    sendVerificationEmail.mockResolvedValue({
      ok: false,
      reason: "send_failed",
    });

    const response = await POST(makeRequest({ email: "new@example.com" }));

    expect(response.status).toBe(500);
  });

  it("returns 400 for invalid input", async () => {
    const response = await POST(makeRequest({ email: "not-an-email" }));

    expect(response.status).toBe(400);
  });
});
