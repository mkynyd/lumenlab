import { describe, expect, it, vi } from "vitest";
import {
  CODE_TTL_MS,
  TICKET_TTL_MS,
  TOKEN_TTL_MS,
  createEmailChallenge,
  createVerificationChallenge,
  emailChallengeGenericFields,
  resolveChallengeChannel,
  resolveChallengePurpose,
  resolveChallengeTarget,
  sha256,
  splitRawToken,
  verifyWithCode,
  verifyWithLink,
  type AuthChallengeRepository,
  type ChallengeForTicketRow,
  type ChallengeRow,
  type ChallengeTokenRow,
} from "@/lib/auth-challenge";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const EMAIL = "new@example.com";

function challengeRow(overrides: Partial<ChallengeRow> = {}): ChallengeRow {
  return {
    id: "challenge-1",
    email: EMAIL,
    type: "verify",
    channel: "email",
    target: EMAIL,
    purpose: "register",
    userId: null,
    codeHash: sha256("123456"),
    codeExpiresAt: new Date(NOW.getTime() + CODE_TTL_MS),
    codeAttempts: 0,
    verifiedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

function tokenRow(overrides: Partial<ChallengeTokenRow> = {}) {
  return {
    email: EMAIL,
    type: "verify",
    channel: "email",
    target: EMAIL,
    purpose: "register",
    tokenHash: sha256("rawTokenPart"),
    tokenExpiresAt: new Date(NOW.getTime() + TOKEN_TTL_MS),
    tokenConsumedAt: null,
    verifiedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

function createRepository(
  overrides: Partial<AuthChallengeRepository> = {}
): AuthChallengeRepository {
  return {
    invalidateActiveChallenges: vi.fn().mockResolvedValue(undefined),
    createChallenge: vi.fn().mockResolvedValue({ id: "challenge-1" }),
    findActiveByEmail: vi.fn().mockResolvedValue(challengeRow()),
    incrementCodeAttempt: vi.fn().mockResolvedValue(true),
    markCodeVerified: vi.fn().mockResolvedValue(true),
    findToken: vi.fn().mockResolvedValue(tokenRow()),
    markTokenVerified: vi.fn().mockResolvedValue(true),
    findChallengeForTicket: vi.fn().mockResolvedValue({
      id: "challenge-1",
      email: EMAIL,
      type: "verify",
      channel: "email",
      target: EMAIL,
      purpose: "register",
      verifiedAt: NOW,
      verifiedVia: "code",
      ticketHash: "hash",
      ticketExpiresAt: NOW,
      ticketConsumedAt: null,
      consumedAt: null,
    } satisfies ChallengeForTicketRow),
    consumeTicket: vi.fn().mockResolvedValue(true),
    completeChallenge: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("verification challenge generic semantics", () => {
  it("maps the legacy type values actually used in this repository", () => {
    // 仓库真实使用的 legacy type 只有 verify（注册验证）与 reset（密码重设）
    expect(resolveChallengePurpose({ type: "verify" })).toBe("register");
    expect(resolveChallengePurpose({ type: "reset" })).toBe("password_reset");
  });

  it("prefers the general purpose column over the legacy type", () => {
    expect(
      resolveChallengePurpose({ purpose: "bind_identity", type: "verify" })
    ).toBe("bind_identity");
  });

  it("derives channel/target for legacy rows written by the previous release", () => {
    const legacyRow = {
      channel: null,
      target: null,
      email: "  Mixed@Case.COM ",
    };
    expect(resolveChallengeChannel(legacyRow)).toBe("email");
    expect(resolveChallengeTarget(legacyRow)).toBe("mixed@case.com");
  });

  it("writes the email channel triple used for dual-write", () => {
    expect(
      emailChallengeGenericFields({ email: "  A@B.com ", purpose: "register" })
    ).toEqual({ channel: "email", target: "a@b.com", purpose: "register" });
  });
});

describe("createVerificationChallenge", () => {
  it("closes previous challenges for the same target and purpose", async () => {
    const repository = createRepository();
    await createVerificationChallenge(
      { purpose: "register", target: "  New@Example.com " },
      { repository, now: NOW }
    );

    expect(repository.invalidateActiveChallenges).toHaveBeenCalledWith(
      "  New@Example.com ",
      "register",
      NOW
    );
    expect(repository.createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "register",
        email: "  New@Example.com ",
      })
    );
  });

  it("supports the password-reset purpose", async () => {
    const repository = createRepository();
    await createVerificationChallenge(
      { purpose: "password_reset", target: EMAIL, userId: "user-1" },
      { repository, now: NOW }
    );

    expect(repository.invalidateActiveChallenges).toHaveBeenCalledWith(
      EMAIL,
      "password_reset",
      NOW
    );
    expect(repository.createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "password_reset", userId: "user-1" })
    );
  });
});

describe("createEmailChallenge", () => {
  it("stores only hashes and returns plaintext once for the email layer", async () => {
    const repository = createRepository();
    const start = await createEmailChallenge(
      { email: EMAIL },
      { repository, now: NOW }
    );

    expect(repository.invalidateActiveChallenges).toHaveBeenCalledWith(
      EMAIL,
      "register",
      NOW
    );
    expect(repository.createChallenge).toHaveBeenCalledWith({
      purpose: "register",
      email: EMAIL,
      userId: undefined,
      codeHash: sha256(start.code),
      codeExpiresAt: new Date(NOW.getTime() + CODE_TTL_MS),
      tokenHash: sha256(start.rawToken),
      tokenExpiresAt: new Date(NOW.getTime() + TOKEN_TTL_MS),
    });
    expect(start.code).toMatch(/^\d{6}$/);
    expect(start.rawToken).toBeTruthy();
  });
});

describe("verifyWithCode", () => {
  it("verifies a correct code and issues a one-time ticket", async () => {
    const repository = createRepository();
    const result = await verifyWithCode(
      { purpose: "register", email: EMAIL, code: "123456" },
      { repository, now: NOW }
    );

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      const split = splitRawToken(result.ticket);
      expect(split).not.toBeNull();
      expect(repository.markCodeVerified).toHaveBeenCalledWith({
        id: "challenge-1",
        ticketHash: sha256(split!.raw),
        ticketExpiresAt: new Date(NOW.getTime() + TICKET_TTL_MS),
        now: NOW,
      });
    }
  });

  it("counts a wrong code and keeps the challenge open", async () => {
    const repository = createRepository();
    const result = await verifyWithCode(
      { purpose: "register", email: EMAIL, code: "000000" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "invalid_code" });
    expect(repository.incrementCodeAttempt).toHaveBeenCalledWith(
      "challenge-1",
      5,
      NOW
    );
    expect(repository.markCodeVerified).not.toHaveBeenCalled();
  });

  it("reports attempts_exceeded when the challenge closed on the final attempt", async () => {
    const repository = createRepository({
      incrementCodeAttempt: vi.fn().mockResolvedValue(false),
    });
    const result = await verifyWithCode(
      { purpose: "register", email: EMAIL, code: "000000" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "attempts_exceeded" });
  });

  it("rejects an expired code", async () => {
    const repository = createRepository({
      findActiveByEmail: vi.fn().mockResolvedValue(
        challengeRow({
          codeExpiresAt: new Date(NOW.getTime() - 1000),
        })
      ),
    });
    const result = await verifyWithCode(
      { purpose: "register", email: EMAIL, code: "123456" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects verification when the challenge is already verified", async () => {
    const repository = createRepository({
      findActiveByEmail: vi.fn().mockResolvedValue(
        challengeRow({ verifiedAt: NOW })
      ),
    });
    const result = await verifyWithCode(
      { purpose: "register", email: EMAIL, code: "123456" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "already_verified" });
  });

  it("rejects verification without an active challenge", async () => {
    const repository = createRepository({
      findActiveByEmail: vi.fn().mockResolvedValue(null),
    });
    const result = await verifyWithCode(
      { purpose: "register", email: EMAIL, code: "123456" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "no_challenge" });
  });

  it("verifies a password-reset challenge by purpose", async () => {
    const repository = createRepository({
      findActiveByEmail: vi.fn().mockResolvedValue(
        challengeRow({ type: "reset", purpose: "password_reset" })
      ),
    });
    const result = await verifyWithCode(
      { purpose: "password_reset", email: EMAIL, code: "123456" },
      { repository, now: NOW }
    );

    expect(result).toMatchObject({ ok: true });
    expect(repository.findActiveByEmail).toHaveBeenCalledWith(
      EMAIL,
      "password_reset"
    );
  });
});

describe("verifyWithLink", () => {
  const TOKEN = "challenge-1.rawTokenPart";

  it("consumes the link token and issues a one-time ticket", async () => {
    const repository = createRepository();
    const result = await verifyWithLink({ token: TOKEN }, { repository, now: NOW });

    expect(result).toMatchObject({ ok: true, email: EMAIL });
    if (result.ok) {
      const split = splitRawToken(result.ticket);
      expect(split).not.toBeNull();
      expect(repository.markTokenVerified).toHaveBeenCalledWith({
        id: "challenge-1",
        tokenHash: sha256("rawTokenPart"),
        ticketHash: sha256(split!.raw),
        ticketExpiresAt: new Date(NOW.getTime() + TICKET_TTL_MS),
        now: NOW,
      });
    }
  });

  it("derives the target from a legacy row whose general columns are still null", async () => {
    const repository = createRepository({
      findToken: vi.fn().mockResolvedValue(
        tokenRow({
          channel: null,
          target: null,
          email: "  Legacy@Example.com ",
        })
      ),
    });
    const result = await verifyWithLink({ token: TOKEN }, { repository, now: NOW });

    expect(result).toMatchObject({ ok: true, email: "legacy@example.com" });
  });

  it("rejects a malformed token", async () => {
    const repository = createRepository();
    const result = await verifyWithLink(
      { token: "no-dot-format" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "malformed" });
    expect(repository.findToken).not.toHaveBeenCalled();
  });

  it("rejects a token whose hash does not match", async () => {
    const repository = createRepository({
      findToken: vi.fn().mockResolvedValue(
        tokenRow({ tokenHash: sha256("something-else") })
      ),
    });
    const result = await verifyWithLink({ token: TOKEN }, { repository, now: NOW });

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects an already-consumed link token", async () => {
    const repository = createRepository({
      findToken: vi.fn().mockResolvedValue(
        tokenRow({ tokenConsumedAt: NOW })
      ),
    });
    const result = await verifyWithLink({ token: TOKEN }, { repository, now: NOW });

    expect(result).toEqual({ ok: false, reason: "already_used" });
  });

  it("rejects a link after the challenge was already verified via code", async () => {
    const repository = createRepository({
      findToken: vi.fn().mockResolvedValue(tokenRow({ verifiedAt: NOW })),
    });
    const result = await verifyWithLink({ token: TOKEN }, { repository, now: NOW });

    expect(result).toEqual({ ok: false, reason: "already_used" });
  });

  it("rejects an expired link token", async () => {
    const repository = createRepository({
      findToken: vi.fn().mockResolvedValue(
        tokenRow({ tokenExpiresAt: new Date(NOW.getTime() - 1000) })
      ),
    });
    const result = await verifyWithLink({ token: TOKEN }, { repository, now: NOW });

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("fails closed when the atomic token claim loses a race", async () => {
    const repository = createRepository({
      markTokenVerified: vi.fn().mockResolvedValue(false),
    });
    const result = await verifyWithLink({ token: TOKEN }, { repository, now: NOW });

    expect(result).toEqual({ ok: false, reason: "already_used" });
  });
});
