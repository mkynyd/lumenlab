import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  checkRateLimit: vi.fn(),
  userFindUnique: vi.fn(),
  bcryptCompare: vi.fn(),
  bcryptHash: vi.fn(),
  updatePassword: vi.fn(),
  invalidatePasswordChangedAtCache: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  RateLimits: { PASSWORD_CHANGE_IP: { max: 5, window: 600_000 } },
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: mocks.bcryptCompare,
    hash: mocks.bcryptHash,
  },
}));

vi.mock("@/lib/data/password-reset-repository", () => ({
  passwordResetRepository: {
    updatePassword: mocks.updatePassword,
  },
}));

vi.mock("@/lib/password-version", () => ({
  invalidatePasswordChangedAtCache: mocks.invalidatePasswordChangedAtCache,
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/user/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/user/password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.userFindUnique.mockResolvedValue({ passwordHash: "old-hash" });
    mocks.bcryptCompare.mockResolvedValue(true);
    mocks.bcryptHash.mockResolvedValue("new-hash");
    mocks.updatePassword.mockResolvedValue(undefined);
    mocks.invalidatePasswordChangedAtCache.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("changes the password and invalidates the pwchg cache", async () => {
    const response = await POST(
      makeRequest({
        currentPassword: "old-password-1",
        newPassword: "new-password-123",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.bcryptCompare).toHaveBeenCalledWith(
      "old-password-1",
      "old-hash"
    );
    expect(mocks.bcryptHash).toHaveBeenCalledWith("new-password-123", 12);
    expect(mocks.updatePassword).toHaveBeenCalledWith(
      "user-1",
      "new-hash",
      expect.any(Date)
    );
    expect(mocks.invalidatePasswordChangedAtCache).toHaveBeenCalledWith(
      "user-1"
    );
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await POST(
      makeRequest({
        currentPassword: "old-password-1",
        newPassword: "new-password-123",
      })
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先登录" });
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false });

    const response = await POST(
      makeRequest({
        currentPassword: "old-password-1",
        newPassword: "new-password-123",
      })
    );

    expect(response.status).toBe(429);
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });

  it("returns 400 when the current password is wrong", async () => {
    mocks.bcryptCompare.mockResolvedValue(false);

    const response = await POST(
      makeRequest({
        currentPassword: "wrong-password",
        newPassword: "new-password-123",
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "当前密码不正确",
    });
    expect(mocks.updatePassword).not.toHaveBeenCalled();
    expect(mocks.invalidatePasswordChangedAtCache).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid new password", async () => {
    const response = await POST(
      makeRequest({ currentPassword: "old-password-1", newPassword: "short" })
    );

    expect(response.status).toBe(400);
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });
});
