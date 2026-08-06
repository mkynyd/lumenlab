import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prisma } = vi.hoisted(() => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ prisma }));

const { sendPasswordResetEmail } = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock("@/lib/email/service", () => ({ sendPasswordResetEmail }));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/auth/password/forgot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/password/forgot", () => {
  beforeEach(() => {
    prisma.user.findUnique.mockReset().mockResolvedValue({ id: "user-1" });
    sendPasswordResetEmail.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a reset email for an existing user", async () => {
    const response = await POST(makeRequest({ email: "user@example.com" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(sendPasswordResetEmail).toHaveBeenCalledWith({
      email: "user@example.com",
      userId: "user-1",
      ip: "unknown",
    });
  });

  it("returns the same success for an unknown email without sending (anti-enumeration)", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const response = await POST(makeRequest({ email: "ghost@example.com" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid input", async () => {
    const response = await POST(makeRequest({ email: "not-an-email" }));

    expect(response.status).toBe(400);
  });
});
