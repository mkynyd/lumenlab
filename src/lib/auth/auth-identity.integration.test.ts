/**
 * 认证身份层数据库契约测试（真实 PostgreSQL）。
 *
 * 覆盖 AuthIdentity 的唯一约束、cascade 删除、注册原子写入、登录/重设密码读路径，
 * 以及 VerificationChallenge 通用列与 legacy 列的兼容语义。
 * 不使用 mock：约束、级联和事务行为只有真实数据库才能证明。
 */

import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { PrismaClient } from "@/generated/prisma/client";
import { normalizeEmail } from "@/lib/auth/identifier";
import { resolveEmailIdentity } from "@/lib/auth/identity";
import { createAuthIdentityRepository } from "@/lib/data/auth-identity-repository";
import { registrationRepository } from "@/lib/data/registration-repository";
import { passwordResetRepository } from "@/lib/data/password-reset-repository";
import { authChallengeRepository } from "@/lib/data/auth-challenge-repository";
import {
  createVerificationChallenge,
  sha256,
  verifyWithCode,
} from "@/lib/auth-challenge";
import { registerUserWithTicket } from "@/lib/register-user";
import { confirmPasswordReset } from "@/lib/password-reset";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const identities = createAuthIdentityRepository(prisma);

const createdUserIds: string[] = [];

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

async function createUser(
  overrides: Partial<{
    email: string;
    passwordHash: string;
    emailVerifiedAt: Date | null;
    emailVerificationSource: string;
  }> = {}
) {
  const user = await prisma.user.create({
    data: {
      email: overrides.email ?? uniqueEmail("auth-contract"),
      passwordHash: overrides.passwordHash ?? "integration-only",
      emailVerifiedAt: overrides.emailVerifiedAt ?? null,
      emailVerificationSource: overrides.emailVerificationSource ?? "none",
    },
  });
  createdUserIds.push(user.id);
  return user;
}

/** 模拟 migration 与 Release 切换窗口内由旧版本创建的用户：只有 legacy 字段 */
async function createLegacyOnlyUser(email: string) {
  return createUser({
    email,
    emailVerifiedAt: new Date("2026-08-01T00:00:00.000Z"),
    emailVerificationSource: "legacy",
  });
}

// 文件级清理：两个 describe 共用同一个连接池，必须在全部用例结束后再关闭
afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
  await pool.end();
});

describe("AuthIdentity database contracts", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  it("keeps a single email identity per account and normalizes providerAccountId", async () => {
    const email = uniqueEmail("identity-shape");
    const user = await createUser({ email, emailVerifiedAt: new Date() });

    const identity = await identities.createEmailIdentity({
      userId: user.id,
      providerAccountId: normalizeEmail(email),
      verifiedAt: user.emailVerifiedAt,
      verificationSource: "code",
    });

    expect(identity).toMatchObject({
      userId: user.id,
      type: "email",
      provider: "local",
      providerAccountId: email.toLowerCase(),
    });

    // @@unique([userId, type])：同一账户不能有第二个 email identity
    const duplicate = await identities.createEmailIdentity({
      userId: user.id,
      providerAccountId: normalizeEmail(`other-${email}`),
      verifiedAt: new Date(),
      verificationSource: "code",
    });
    expect(duplicate).toBeNull();
  });

  it("rejects the same external identity on two different accounts", async () => {
    const email = uniqueEmail("identity-unique");
    const first = await createUser({ email, emailVerifiedAt: new Date() });
    const second = await createUser({
      email: uniqueEmail("identity-unique-other"),
      emailVerifiedAt: new Date(),
    });

    const created = await identities.createEmailIdentity({
      userId: first.id,
      providerAccountId: normalizeEmail(email),
      verifiedAt: new Date(),
      verificationSource: "code",
    });
    expect(created).not.toBeNull();

    const conflict = await identities.createEmailIdentity({
      userId: second.id,
      providerAccountId: normalizeEmail(email),
      verifiedAt: new Date(),
      verificationSource: "code",
    });
    expect(conflict).toBeNull();
  });

  it("resolves identities case-insensitively and self-heals legacy-only accounts", async () => {
    const email = uniqueEmail("legacy-heal");
    const user = await createLegacyOnlyUser(email);

    const first = await resolveEmailIdentity(email.toUpperCase(), identities);
    expect(first).toMatchObject({
      kind: "resolved",
      userId: user.id,
      selfHealed: true,
    });

    // 幂等：第二次解析命中已补写的 identity，不再 self-heal
    const second = await resolveEmailIdentity(email, identities);
    expect(second).toMatchObject({
      kind: "resolved",
      userId: user.id,
      selfHealed: false,
    });

    const persisted = await prisma.authIdentity.findMany({
      where: { userId: user.id },
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      type: "email",
      provider: "local",
      providerAccountId: email,
      verificationSource: "legacy",
    });
  });

  it("finds legacy accounts whose stored email differs in case or padding", async () => {
    const email = uniqueEmail("legacy-case");
    const mixedCase = `  ${email.toUpperCase()}  `;
    const user = await createUser({
      email: mixedCase,
      emailVerifiedAt: new Date("2026-08-02T00:00:00.000Z"),
      emailVerificationSource: "legacy",
    });

    const resolution = await resolveEmailIdentity(email, identities);

    expect(resolution).toMatchObject({
      kind: "resolved",
      userId: user.id,
      selfHealed: true,
    });
    const healed = await prisma.authIdentity.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "local",
          providerAccountId: email.toLowerCase(),
        },
      },
    });
    expect(healed?.userId).toBe(user.id);
  });

  it("cascade deletes identities with the account and leaves business data keyed by User.id", async () => {
    const email = uniqueEmail("cascade");
    const user = await createUser({ email, emailVerifiedAt: new Date() });
    await identities.createEmailIdentity({
      userId: user.id,
      providerAccountId: email,
      verifiedAt: new Date(),
      verificationSource: "code",
    });
    const project = await prisma.project.create({
      data: { userId: user.id, name: "Auth cascade fixture" },
    });

    await prisma.user.delete({ where: { id: user.id } });
    createdUserIds.splice(createdUserIds.indexOf(user.id), 1);

    expect(
      await prisma.authIdentity.count({ where: { userId: user.id } })
    ).toBe(0);
    // 业务数据仍以 User.id 为唯一关联键，并随账户级联清理
    expect(await prisma.project.count({ where: { id: project.id } })).toBe(0);
  });

  it("registers User + email identity atomically and dual-writes the legacy fields", async () => {
    const email = uniqueEmail("register-atomic");
    const start = await createVerificationChallenge(
      { purpose: "register", target: email },
      { repository: authChallengeRepository }
    );
    const verified = await verifyWithCode(
      { purpose: "register", email, code: start.code },
      { repository: authChallengeRepository }
    );
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    const passwordHash = await bcrypt.hash("register-password-123", 4);
    const user = await registerUserWithTicket(
      { email: email.toUpperCase(), passwordHash, ticket: verified.ticket },
      { repository: registrationRepository }
    );

    createdUserIds.push(user.id);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        email: true,
        passwordHash: true,
        emailVerifiedAt: true,
        emailVerificationSource: true,
      },
    });
    expect(stored.email).toBe(email);
    expect(stored.passwordHash).toBe(passwordHash);
    expect(stored.emailVerifiedAt).not.toBeNull();
    expect(stored.emailVerificationSource).toBe("code");

    const identity = await prisma.authIdentity.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "email" } },
    });
    expect(identity).toMatchObject({
      provider: "local",
      providerAccountId: email,
      verificationSource: "code",
    });
    expect(identity.verifiedAt?.getTime()).toBe(
      stored.emailVerifiedAt?.getTime()
    );
  });

  it("treats differently cased or padded emails as the same account", async () => {
    const email = uniqueEmail("case-unique");
    const user = await createUser({ email, emailVerifiedAt: new Date() });
    await identities.createEmailIdentity({
      userId: user.id,
      providerAccountId: email,
      verifiedAt: new Date(),
      verificationSource: "code",
    });

    const resolution = await resolveEmailIdentity(
      `  ${email.toUpperCase()}  `,
      identities
    );
    expect(resolution).toMatchObject({ kind: "resolved", userId: user.id });
  });

  it("writes password resets only to User.passwordHash and bumps passwordChangedAt", async () => {
    const email = uniqueEmail("reset-write");
    const user = await createUser({
      email,
      passwordHash: await bcrypt.hash("old-password-123", 4),
      emailVerifiedAt: new Date(),
      emailVerificationSource: "code",
    });
    await identities.createEmailIdentity({
      userId: user.id,
      providerAccountId: email,
      verifiedAt: new Date(),
      verificationSource: "code",
    });

    const start = await createVerificationChallenge(
      { purpose: "password_reset", target: email, userId: user.id },
      { repository: authChallengeRepository }
    );
    const newHash = await bcrypt.hash("new-password-456", 4);
    const result = await confirmPasswordReset(
      { ticket: `${start.challengeId}.${start.rawToken}`, passwordHash: newHash },
      { repository: passwordResetRepository }
    );

    expect(result).toEqual({ ok: true });

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, passwordChangedAt: true },
    });
    expect(stored.passwordHash).toBe(newHash);
    expect(stored.passwordChangedAt).not.toBeNull();

    // identity 不持有任何凭证字段；密码只有 User.passwordHash 一个落点
    const identity = await prisma.authIdentity.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "email" } },
    });
    expect(Object.keys(identity)).not.toContain("passwordHash");
  });
});

describe("VerificationChallenge expand compatibility", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });

  it("dual-writes legacy type/email and the general channel/target/purpose", async () => {
    const email = uniqueEmail("challenge-dual");
    const start = await createVerificationChallenge(
      { purpose: "password_reset", target: `  ${email.toUpperCase()}  ` },
      { repository: authChallengeRepository }
    );

    const row = await prisma.emailChallenge.findUniqueOrThrow({
      where: { id: start.challengeId },
    });
    expect(row).toMatchObject({
      type: "reset",
      email: email,
      channel: "email",
      target: email,
      purpose: "password_reset",
    });
    await prisma.emailChallenge.delete({ where: { id: start.challengeId } });
  });

  it("reads a legacy-only challenge written by the previous release", async () => {
    const email = uniqueEmail("challenge-legacy");
    const code = "424242";
    const legacyRow = await prisma.emailChallenge.create({
      data: {
        // 旧 Release 只写这两列，通用列保持 NULL
        type: "verify",
        email,
        codeHash: sha256(code),
        codeExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        tokenHash: sha256(`legacy-token-${randomUUID()}`),
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    expect(legacyRow.channel).toBeNull();
    expect(legacyRow.purpose).toBeNull();

    const found = await authChallengeRepository.findActiveByEmail(
      email,
      "register"
    );
    // 通用列缺失时按 legacy type/email 无损推导
    expect(found).toMatchObject({
      id: legacyRow.id,
      channel: "email",
      target: email,
      purpose: "register",
    });

    const verified = await verifyWithCode(
      { purpose: "register", email, code },
      { repository: authChallengeRepository }
    );
    expect(verified).toMatchObject({ ok: true });

    const after = await prisma.emailChallenge.findUniqueOrThrow({
      where: { id: legacyRow.id },
    });
    expect(after.verifiedVia).toBe("code");
    expect(after.ticketHash).not.toBeNull();

    await prisma.emailChallenge.delete({ where: { id: legacyRow.id } });
  });

  it("keeps unconsumed reset tokens issued before the migration usable", async () => {
    const email = uniqueEmail("reset-legacy");
    const raw = `legacy-reset-${randomUUID()}`;
    const legacyRow = await prisma.emailChallenge.create({
      data: {
        type: "reset",
        email,
        codeHash: sha256("000000"),
        codeExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        tokenHash: sha256(raw),
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const token = await passwordResetRepository.findResetToken(legacyRow.id);
    expect(token).toMatchObject({ target: email, tokenHash: sha256(raw) });

    const read = await passwordResetRepository.findResetToken(legacyRow.id);
    expect(read?.tokenConsumedAt).toBeNull();

    await prisma.emailChallenge.delete({ where: { id: legacyRow.id } });
  });

  it("closes legacy-only active challenges when a new one is issued for the same purpose", async () => {
    const email = uniqueEmail("challenge-invalidate");
    const legacyRow = await prisma.emailChallenge.create({
      data: {
        type: "verify",
        email,
        codeHash: sha256("111111"),
        codeExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        tokenHash: sha256(`legacy-invalidate-${randomUUID()}`),
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const start = await createVerificationChallenge(
      { purpose: "register", target: email },
      { repository: authChallengeRepository }
    );

    const closed = await prisma.emailChallenge.findUniqueOrThrow({
      where: { id: legacyRow.id },
    });
    expect(closed.consumedAt).not.toBeNull();

    // 新挑战带完整通用列
    const created = await prisma.emailChallenge.findUniqueOrThrow({
      where: { id: start.challengeId },
    });
    expect(created).toMatchObject({
      type: "verify",
      channel: "email",
      target: email,
      purpose: "register",
    });

    await prisma.emailChallenge.deleteMany({
      where: { id: { in: [legacyRow.id, start.challengeId] } },
    });
  });
});
