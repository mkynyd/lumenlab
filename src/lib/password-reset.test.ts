import { describe, expect, it, vi } from "vitest";
import {
  confirmPasswordReset,
  type PasswordResetRepository,
  type PasswordResetTokenRow,
} from "@/lib/password-reset";
import { sha256 } from "@/lib/auth-challenge";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const CHALLENGE_ID = "challenge-1";
const RAW = "rawTokenRawTokenRawTokenRawTokenRawTokenRawTok";
const TICKET = `${CHALLENGE_ID}.${RAW}`;
const TOKEN_HASH = sha256(RAW);

function tokenRow(overrides: Partial<PasswordResetTokenRow> = {}): PasswordResetTokenRow {
  return {
    email: "user@example.com",
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
    findResetToken: vi.fn().mockResolvedValue(tokenRow()),
    claimResetToken: vi.fn().mockResolvedValue(true),
    findUserByEmail: vi.fn().mockResolvedValue({ id: "user-1" }),
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
    expect(repository.updatePassword).toHaveBeenCalledWith(
      "user-1",
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
      findUserByEmail: vi.fn().mockResolvedValue(null),
    });
    repository.transaction = async (operation) => operation(repository);

    const result = await confirmPasswordReset(
      { ticket: TICKET, passwordHash: "new-hash" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "user_not_found" });
    expect(repository.updatePassword).not.toHaveBeenCalled();
  });
});
