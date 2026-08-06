import { describe, expect, it, vi } from "vitest";
import {
  CODE_TTL_MS,
  TICKET_TTL_MS,
  TOKEN_TTL_MS,
  createEmailChallenge,
  sha256,
  splitRawToken,
  verifyWithCode,
  verifyWithLink,
  type AuthChallengeRepository,
  type ChallengeForTicketRow,
  type EmailChallengeRow,
  type EmailChallengeTokenRow,
} from "@/lib/auth-challenge";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const EMAIL = "new@example.com";

function challengeRow(
  overrides: Partial<EmailChallengeRow> = {}
): EmailChallengeRow {
  return {
    id: "challenge-1",
    email: EMAIL,
    type: "verify",
    userId: null,
    codeHash: sha256("123456"),
    codeExpiresAt: new Date(NOW.getTime() + CODE_TTL_MS),
    codeAttempts: 0,
    verifiedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

function tokenRow(overrides: Partial<EmailChallengeTokenRow> = {}) {
  return {
    email: EMAIL,
    type: "verify",
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

describe("createEmailChallenge", () => {
  it("stores only hashes and returns plaintext once for the email layer", async () => {
    const repository = createRepository();
    const start = await createEmailChallenge(
      { type: "verify", email: EMAIL },
      { repository, now: NOW }
    );

    expect(repository.invalidateActiveChallenges).toHaveBeenCalledWith(
      EMAIL,
      "verify",
      NOW
    );
    expect(repository.createChallenge).toHaveBeenCalledWith({
      type: "verify",
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
      { type: "verify", email: EMAIL, code: "123456" },
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
      { type: "verify", email: EMAIL, code: "000000" },
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
      { type: "verify", email: EMAIL, code: "000000" },
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
      { type: "verify", email: EMAIL, code: "123456" },
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
      { type: "verify", email: EMAIL, code: "123456" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "already_verified" });
  });

  it("rejects verification without an active challenge", async () => {
    const repository = createRepository({
      findActiveByEmail: vi.fn().mockResolvedValue(null),
    });
    const result = await verifyWithCode(
      { type: "verify", email: EMAIL, code: "123456" },
      { repository, now: NOW }
    );

    expect(result).toEqual({ ok: false, reason: "no_challenge" });
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
