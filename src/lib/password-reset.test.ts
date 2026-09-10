import { describe, expect, it, vi } from "vitest";
import {
  confirmPasswordReset,
  type PasswordResetRepository,
  type PasswordResetTokenRow,
} from "@/lib/password-reset";
import { sha256 } from "@/lib/auth-challenge";
import type { AuthIdentityRow } from "@/lib/auth/identity";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const CHALLENGE_ID = "challenge-1";
const RAW = "rawTokenRawTokenRawTokenRawTokenRawTokenRawTok";
const TICKET = `${CHALLENGE_ID}.${RAW}`;
const TOKEN_HASH = sha256(RAW);
const EMAIL = "user@example.com";

function identityRow(overrides: Partial<AuthIdentityRow> = {}): AuthIdentityRow {
  return {
    id: "identity-1",
    userId: "user-1",
    type: "email",
    provider: "local",
    providerAccountId: EMAIL,
    verifiedAt: NOW,
    verificationSource: "legacy",
    ...overrides,
  };
}

function tokenRow(overrides: Partial<PasswordResetTokenRow> = {}): PasswordResetTokenRow {
  return {
    target: EMAIL,
    tokenHash: TOKEN_HASH,
    tokenExpiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    tokenConsumedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

function createRepository(
  overrides: Partial<PasswordResetRepository> = {}
): PasswordResetRepository {
  return {
    findEmailIdentity: vi.fn().mockResolvedValue(identityRow()),
    createEmailIdentity: vi.fn().mockResolvedValue(identityRow()),
    findEmailIdentityByUserId: vi.fn().mockResolvedValue(identityRow()),
    getUserByNormalizedEmail: vi.fn().mockResolvedValue({
      id: "user-1",
      email: EMAIL,
      emailVerifiedAt: NOW,
      emailVerificationSource: "legacy",
    }),
    findResetToken: vi.fn().mockResolvedValue(tokenRow()),
    claimResetToken: vi.fn().mockResolvedValue(true),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    transaction: async () => {
      throw new Error("transaction must be replaced by the test");
    },
    ...overrides,
  };
}

describe("confirmPasswordReset", () => {
  it("claims the token and updates the password with passwordChangedAt", async () => {
    const repository = createRepository();
    repository.transaction = async (operation) => operation(repository);

    const result = await confirmPasswordReset(
      { ticket: TICKET, passwordHash: "new-hash" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: true });
    expect(repository.claimResetToken).toHaveBeenCalledWith({
      challengeId: CHALLENGE_ID,
      tokenHash: TOKEN_HASH,
      now: NOW,
    });
    // 密码始终写在账户主键 User.id 上（不是 identity id）
    expect(repository.updatePassword).toHaveBeenCalledWith(
      "user-1",
      "new-hash",
      NOW
    );
  });

  it("resolves the account through the email identity", async () => {
    const repository = createRepository();
    repository.transaction = async (operation) => operation(repository);

    await confirmPasswordReset(
      { ticket: TICKET, passwordHash: "new-hash" },
      { repository, now: NOW }
    );

    expect(repository.findEmailIdentity).toHaveBeenCalledWith(EMAIL);
  });

  it("falls back to a legacy-only account created during the migration window and self-heals", async () => {
    const repository = createRepository({
      findEmailIdentity: vi.fn().mockResolvedValue(null),
      getUserByNormalizedEmail: vi.fn().mockResolvedValue({
        id: "legacy-user",
        email: EMAIL,
        emailVerifiedAt: NOW,
        emailVerificationSource: "legacy",
      }),
      createEmailIdentity: vi
        .fn()
        .mockResolvedValue(identityRow({ userId: "legacy-user" })),
    });
    repository.transaction = async (operation) => operation(repository);

    const result = await confirmPasswordReset(
      { ticket: TICKET, passwordHash: "new-hash" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: true });
    expect(repository.createEmailIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "legacy-user" })
    );
    expect(repository.updatePassword).toHaveBeenCalledWith(
      "legacy-user",
      "new-hash",
      NOW
    );
  });

  it("rejects a malformed ticket", async () => {
    const repository = createRepository();
    repository.transaction = async (operation) => operation(repository);

    const result = await confirmPasswordReset(
      { ticket: "no-dot-format", passwordHash: "new-hash" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(repository.findResetToken).not.toHaveBeenCalled();
  });

  it("rejects a ticket whose hash does not match", async () => {
    const repository = createRepository({
      findResetToken: vi.fn().mockResolvedValue(
        tokenRow({ tokenHash: sha256("other") })
      ),
    });
    repository.transaction = async (operation) => operation(repository);

    const result = await confirmPasswordReset(
      { ticket: TICKET, passwordHash: "new-hash" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an already-consumed token", async () => {
    const repository = createRepository({
      findResetToken: vi.fn().mockResolvedValue(
        tokenRow({ tokenConsumedAt: NOW })
      ),
    });
    repository.transaction = async (operation) => operation(repository);

    const result = await confirmPasswordReset(
      { ticket: TICKET, passwordHash: "new-hash" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "used" });
  });

  it("rejects an expired token", async () => {
    const repository = createRepository({
      findResetToken: vi.fn().mockResolvedValue(
        tokenRow({ tokenExpiresAt: new Date(NOW.getTime() - 1000) })
      ),
    });
    repository.transaction = async (operation) => operation(repository);

    const result = await confirmPasswordReset(
      { ticket: TICKET, passwordHash: "new-hash" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("fails closed when the atomic claim loses a race", async () => {
    const repository = createRepository({
      claimResetToken: vi.fn().mockResolvedValue(false),
    });
    repository.transaction = async (operation) => operation(repository);

    const result = await confirmPasswordReset(
      { ticket: TICKET, passwordHash: "new-hash" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "used" });
    expect(repository.updatePassword).not.toHaveBeenCalled();
  });

  it("does not update a password for a deleted user", async () => {
    const repository = createRepository({
      findEmailIdentity: vi.fn().mockResolvedValue(null),
      getUserByNormalizedEmail: vi.fn().mockResolvedValue(null),
    });
    repository.transaction = async (operation) => operation(repository);

    const result = await confirmPasswordReset(
      { ticket: TICKET, passwordHash: "new-hash" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "user_not_found" });
    expect(repository.updatePassword).not.toHaveBeenCalled();
  });

  it("stops when the identity and the legacy user disagree", async () => {
    const repository = createRepository({
      findEmailIdentity: vi.fn().mockResolvedValue(
        identityRow({ userId: "other-user" })
      ),
      getUserByNormalizedEmail: vi.fn().mockResolvedValue({
        id: "legacy-user",
        email: EMAIL,
        emailVerifiedAt: NOW,
        emailVerificationSource: "legacy",
      }),
    });
    repository.transaction = async (operation) => operation(repository);

    const result = await confirmPasswordReset(
      { ticket: TICKET, passwordHash: "new-hash" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "identity_conflict" });
    expect(repository.updatePassword).not.toHaveBeenCalled();
  });
});
