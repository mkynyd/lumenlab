import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { resolveEmail } = vi.hoisted(() => ({ resolveEmail: vi.fn() }));
vi.mock("@/lib/auth/service", () => ({ resolveEmail }));

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
    resolveEmail.mockReset().mockResolvedValue({
      kind: "resolved",
      identity: {
        identity: {
          id: "identity-1",
          userId: "user-1",
          type: "email",
          provider: "local",
          providerAccountId: "user@example.com",
          verifiedAt: new Date("2026-08-06T12:00:00.000Z"),
          verificationSource: "legacy",
        },
        userId: "user-1",
        selfHealed: false,
      },
    });
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
    resolveEmail.mockResolvedValue({ kind: "not_found" });

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
