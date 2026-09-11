/**
 * @vitest-environment node
 *
 * 登录路径（Credentials authorize）单元测试。
 *
 * 覆盖迁移后必须保持不变的安全语义：dummy bcrypt 时序防护、IP+identifier
 * 限流、LoginAttempt 审计、未验证邮箱拒绝登录、JWT 账户主键仍是 User.id。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, checkRateLimit, resolveIdentifier, readEmailVerificationState, bcrypt } =
  vi.hoisted(() => ({
    prisma: {
      user: { findUnique: vi.fn() },
      loginAttempt: { create: vi.fn() },
    },
    checkRateLimit: vi.fn(),
    resolveIdentifier: vi.fn(),
    readEmailVerificationState: vi.fn(),
    bcrypt: {
      compare: vi.fn(),
      // 模块加载时 login.ts 用 hashSync 生成 DUMMY_HASH，sentinel 用于断言
      hashSync: vi.fn().mockReturnValue("login-timing-dummy-hash"),
    },
  }));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit,
  RateLimits: { LOGIN: { max: 5, window: 60_000 } },
}));
vi.mock("@/lib/auth/service", () => ({ resolveIdentifier, readEmailVerificationState }));
vi.mock("bcryptjs", () => ({ default: bcrypt }));

import { authorizeWithEmailPassword } from "@/lib/auth/login";

const DUMMY_HASH_SENTINEL = "login-timing-dummy-hash";
import type { EmailIdentityResolution } from "@/lib/auth/identity";

const USER_ROW = {
  id: "user-1",
  email: "user@example.com",
  name: "User",
  passwordHash: "stored-hash",
  avatarPreset: "lumen",
  avatarStorageProvider: null,
  avatarObjectKey: null,
  avatarMimeType: null,
  avatarUpdatedAt: null,
  passwordChangedAt: new Date("2026-08-05T00:00:00.000Z"),
};

function resolved(
  userId = USER_ROW.id,
  verifiedAt: Date | null = new Date("2026-08-01T00:00:00.000Z")
): EmailIdentityResolution {
  return {
    kind: "resolved",
    identity: {
      id: "identity-1",
      userId,
      type: "email",
      provider: "local",
      providerAccountId: USER_ROW.email,
      verifiedAt,
      verificationSource: "legacy",
    },
    userId,
    selfHealed: false,
  };
}

function request(ip = "203.0.113.9"): Request {
  return new Request("http://localhost/api/auth/callback/credentials", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("authorizeWithEmailPassword", () => {
  beforeEach(() => {
    prisma.user.findUnique.mockReset().mockResolvedValue(USER_ROW);
    prisma.loginAttempt.create.mockReset().mockResolvedValue({});
    checkRateLimit.mockReset().mockResolvedValue({ allowed: true });
    resolveIdentifier.mockReset().mockResolvedValue(resolved());
    readEmailVerificationState
      .mockReset()
      .mockResolvedValue({ verifiedAt: new Date("2026-08-01T00:00:00.000Z"), source: "identity" });
    bcrypt.compare.mockReset().mockResolvedValue(true);
  });

  it("resolves the account through the email identity and returns User.id", async () => {
    const user = await authorizeWithEmailPassword(
      { email: "user@example.com", password: "password123" },
      request()
    );

    expect(resolveIdentifier).toHaveBeenCalledWith("user@example.com");
    // JWT 主键必须是 User.id，不能是 AuthIdentity.id
    expect(user).toMatchObject({
      id: "user-1",
      email: "user@example.com",
      passwordChangedAt: new Date("2026-08-05T00:00:00.000Z").getTime(),
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } })
    );
  });

  it("normalizes the submitted email before resolving and rate limiting", async () => {
    await authorizeWithEmailPassword(
      { email: "  User@Example.COM ", password: "password123" },
      request()
    );

    expect(resolveIdentifier).toHaveBeenCalledWith("user@example.com");
    expect(checkRateLimit).toHaveBeenCalledWith(
      "login:203.0.113.9:user@example.com",
      5,
      60_000
    );
  });

  it("rejects a wrong password and audits the failure", async () => {
    bcrypt.compare.mockResolvedValue(false);

    const user = await authorizeWithEmailPassword(
      { email: "user@example.com", password: "wrong-password" },
      request()
    );

    expect(user).toBeNull();
    expect(prisma.loginAttempt.create).toHaveBeenCalledWith({
      data: { email: "user@example.com", identifier: "user@example.com", identityType: "email", ip: "203.0.113.9", success: false },
    });
  });

  it("keeps the dummy bcrypt comparison for unknown accounts (timing protection)", async () => {
    resolveIdentifier.mockResolvedValue({ kind: "not_found" });
    bcrypt.compare.mockResolvedValue(false);

    const user = await authorizeWithEmailPassword(
      { email: "ghost@example.com", password: "password123" },
      request()
    );

    expect(user).toBeNull();
    // 未知账户也必须执行一次 bcrypt.compare，且不查 User 表
    // 第二次参数是模块级 DUMMY_HASH（bcrypt 10 rounds 的 hash 串），
    // 不是任何真实账户的密码 hash
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    expect(bcrypt.compare.mock.calls[0][0]).toBe("password123");
    // 第二个参数是模块级 DUMMY_HASH（加载时由 bcrypt.hashSync 生成），
    // 与任何真实账户的 passwordHash 无关
    expect(bcrypt.compare.mock.calls[0][1]).toBe(DUMMY_HASH_SENTINEL);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("self-heals a legacy-only account during the migration window and still logs in", async () => {
    resolveIdentifier.mockResolvedValue({
      ...(resolved() as Extract<EmailIdentityResolution, { kind: "resolved" }>),
      selfHealed: true,
    });

    const user = await authorizeWithEmailPassword(
      { email: "user@example.com", password: "password123" },
      request()
    );

    expect(user).toMatchObject({ id: "user-1" });
    expect(prisma.loginAttempt.create).toHaveBeenCalledWith({
      data: { email: "user@example.com", identifier: "user@example.com", identityType: "email", ip: "203.0.113.9", success: true },
    });
  });

  it("rejects an unverified email after the password check", async () => {
    resolveIdentifier.mockResolvedValue(resolved(USER_ROW.id, null));

    await expect(
      authorizeWithEmailPassword(
        { email: "user@example.com", password: "password123" },
        request()
      )
    ).rejects.toMatchObject({ code: "email_not_verified" });

    // 时序防护：密码比较发生在验证状态检查之前
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    expect(prisma.loginAttempt.create).toHaveBeenCalledWith({
      data: { email: "user@example.com", identifier: "user@example.com", identityType: "email", ip: "203.0.113.9", success: false },
    });
  });

  it("rejects when the rate limit is exhausted and audits the attempt", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false });

    const user = await authorizeWithEmailPassword(
      { email: "user@example.com", password: "password123" },
      request()
    );

    expect(user).toBeNull();
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(prisma.loginAttempt.create).toHaveBeenCalledWith({
      data: { email: "user@example.com", identifier: "user@example.com", identityType: "email", ip: "203.0.113.9", success: false },
    });
  });

  it("rejects malformed credentials without touching the database", async () => {
    const user = await authorizeWithEmailPassword(
      { email: "not-an-email", password: "short" },
      request()
    );

    expect(user).toBeNull();
    expect(resolveIdentifier).not.toHaveBeenCalled();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it("does not block login when the audit write fails", async () => {
    prisma.loginAttempt.create.mockRejectedValue(new Error("audit down"));

    const user = await authorizeWithEmailPassword(
      { email: "user@example.com", password: "password123" },
      request()
    );

    expect(user).toMatchObject({ id: "user-1" });
  });

  it("derives the dummy hash from bcrypt.hashSync at module load", () => {
    expect(bcrypt.hashSync).toHaveBeenCalledWith("login-timing-dummy", 10);
  });
});

describe("phone credentials", () => {
  beforeEach(() => {
    prisma.user.findUnique.mockReset().mockResolvedValue({ ...USER_ROW, email: null });
    prisma.loginAttempt.create.mockReset().mockResolvedValue({});
    checkRateLimit.mockReset().mockResolvedValue({ allowed: true });
    resolveIdentifier.mockReset().mockResolvedValue(resolved());
    bcrypt.compare.mockReset().mockResolvedValue(true);
  });
  it("normalizes phone, reads User only by id, and keeps email null in the session account", async () => {
    const user = await authorizeWithEmailPassword({ identifier: "13812345678", password: "password123" }, request());
    expect(user).toMatchObject({ id: "user-1", email: null });
    expect(resolveIdentifier).toHaveBeenCalledWith("+8613812345678");
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "user-1" } }));
    expect(bcrypt.compare).toHaveBeenCalledWith("password123", "stored-hash");
    expect(prisma.loginAttempt.create).toHaveBeenCalledWith({ data: { email: null, identifier: "+8613812345678", identityType: "phone", ip: "203.0.113.9", success: true } });
  });
  it("uses one dummy bcrypt for nonexistent phones", async () => {
    resolveIdentifier.mockResolvedValue({ kind: "not_found" });
    bcrypt.compare.mockResolvedValue(false);
    expect(await authorizeWithEmailPassword({ identifier: "13812345678", password: "password123" }, request())).toBeNull();
    expect(bcrypt.compare).toHaveBeenCalledExactlyOnceWith("password123", DUMMY_HASH_SENTINEL);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it("rejects an unverified phone after password comparison", async () => {
    resolveIdentifier.mockResolvedValue(resolved(USER_ROW.id, null));
    await expect(authorizeWithEmailPassword({ identifier: "+8613812345678", password: "password123" }, request())).rejects.toMatchObject({ code: "identity_not_verified" });
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
  });
  it("audit failure does not block phone login", async () => {
    prisma.loginAttempt.create.mockRejectedValue(new Error("offline"));
    expect(await authorizeWithEmailPassword({ identifier: "13812345678", password: "password123" }, request())).toMatchObject({ id: "user-1" });
  });
});
