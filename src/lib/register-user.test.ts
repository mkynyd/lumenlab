import { describe, expect, it, vi } from "vitest";
import {
  RegistrationError,
  registerUserWithTicket,
  type ChallengeTicketRow,
  type RegistrationRepository,
} from "@/lib/register-user";
import { sha256 } from "@/lib/auth-challenge";
import type { AuthIdentityRow } from "@/lib/auth/identity";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const CHALLENGE_ID = "challenge-1";
const RAW_TICKET = "rawTicketRawTicketRawTicketRawTicketRawTicketRa";
const TICKET = `${CHALLENGE_ID}.${RAW_TICKET}`;
const TICKET_HASH = sha256(RAW_TICKET);

const input = {
  email: "new@example.com",
  passwordHash: "hashed-password",
  ticket: TICKET,
};

function identityRow(overrides: Partial<AuthIdentityRow> = {}): AuthIdentityRow {
  return {
    id: "identity-1",
    userId: "user-1",
    type: "email",
    provider: "local",
    providerAccountId: input.email,
    verifiedAt: new Date("2026-08-06T11:50:00.000Z"),
    verificationSource: "code",
    ...overrides,
  };
}

function challengeRow(
  overrides: Partial<ChallengeTicketRow> = {}
): ChallengeTicketRow {
  return {
    id: CHALLENGE_ID,
    target: input.email,
    verifiedAt: new Date("2026-08-06T11:50:00.000Z"),
    verifiedVia: "code",
    ticketHash: TICKET_HASH,
    ticketExpiresAt: new Date("2026-08-06T12:15:00.000Z"),
    ticketConsumedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

function createRepository(
  overrides: Partial<RegistrationRepository> = {}
): RegistrationRepository {
  return {
    findEmailIdentity: vi.fn().mockResolvedValue(null),
    createEmailIdentity: vi.fn().mockResolvedValue(identityRow()),
    findEmailIdentityByUserId: vi.fn().mockResolvedValue(null),
    getUserByNormalizedEmail: vi.fn().mockResolvedValue(null),
    findChallengeForTicket: vi.fn().mockResolvedValue(challengeRow()),
    consumeTicket: vi.fn().mockResolvedValue(true),
    findDefaultCredentialProfile: vi.fn().mockResolvedValue({
      id: "profile-1",
    }),
    createUser: vi.fn().mockResolvedValue({
      id: "user-1",
      email: input.email,
      name: null,
    }),
    completeChallenge: vi.fn().mockResolvedValue(undefined),
    transaction: async () => {
      throw new Error("transaction must be replaced by the test");
    },
    ...overrides,
  };
}

describe("registerUserWithTicket", () => {
  it("consumes the ticket and creates the user with verified state and default profile", async () => {
    const repository = createRepository();
    repository.transaction = async (operation) => operation(repository);

    const user = await registerUserWithTicket(input, {
      repository,
      now: NOW,
    });

    expect(repository.consumeTicket).toHaveBeenCalledWith({
      challengeId: CHALLENGE_ID,
      ticketHash: TICKET_HASH,
      now: NOW,
    });
    expect(repository.createUser).toHaveBeenCalledWith({
      email: input.email,
      passwordHash: input.passwordHash,
      credentialProfileId: "profile-1",
      emailVerifiedAt: new Date("2026-08-06T11:50:00.000Z"),
      emailVerificationSource: "code",
    });
    expect(repository.completeChallenge).toHaveBeenCalledWith(
      CHALLENGE_ID,
      NOW
    );
    expect(user).toEqual({
      id: "user-1",
      email: input.email,
      name: null,
    });
  });

  it("creates the email identity in the same transaction as the user", async () => {
    const repository = createRepository();
    repository.transaction = async (operation) => operation(repository);

    await registerUserWithTicket(input, { repository, now: NOW });

    expect(repository.createEmailIdentity).toHaveBeenCalledWith({
      userId: "user-1",
      providerAccountId: input.email,
      verifiedAt: new Date("2026-08-06T11:50:00.000Z"),
      verificationSource: "code",
    });
  });

  it("normalizes the email before writing the user and the identity", async () => {
    const repository = createRepository({
      findChallengeForTicket: vi.fn().mockResolvedValue(
        challengeRow({ target: "new@example.com" })
      ),
    });
    repository.transaction = async (operation) => operation(repository);

    await registerUserWithTicket(
      { ...input, email: "  New@Example.COM  " },
      { repository, now: NOW }
    );

    expect(repository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@example.com" })
    );
    expect(repository.createEmailIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ providerAccountId: "new@example.com" })
    );
  });

  it("rejects an email that is already registered through its identity", async () => {
    const repository = createRepository({
      findEmailIdentity: vi.fn().mockResolvedValue(identityRow()),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithTicket(input, { repository, now: NOW })
    ).rejects.toEqual(
      new RegistrationError("email_exists", "该邮箱已被注册")
    );
    expect(repository.consumeTicket).not.toHaveBeenCalled();
  });

  it("rejects an email owned by a legacy-only user created during the migration window", async () => {
    const repository = createRepository({
      // 只有 legacy User.email，没有 AuthIdentity（旧 Release 在切换窗口内创建）
      getUserByNormalizedEmail: vi.fn().mockResolvedValue({
        id: "legacy-user",
        email: "new@example.com",
        emailVerifiedAt: NOW,
        emailVerificationSource: "legacy",
      }),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithTicket(input, { repository, now: NOW })
    ).rejects.toEqual(
      new RegistrationError("email_exists", "该邮箱已被注册")
    );
    expect(repository.createUser).not.toHaveBeenCalled();
  });

  it("stops with identity_conflict when the identity and the legacy user disagree", async () => {
    const repository = createRepository({
      findEmailIdentity: vi.fn().mockResolvedValue(
        identityRow({ userId: "other-user" })
      ),
      getUserByNormalizedEmail: vi.fn().mockResolvedValue({
        id: "legacy-user",
        email: "new@example.com",
        emailVerifiedAt: NOW,
        emailVerificationSource: "legacy",
      }),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithTicket(input, { repository, now: NOW })
    ).rejects.toMatchObject({ code: "identity_conflict" });
    expect(repository.createUser).not.toHaveBeenCalled();
  });

  it("fails the whole registration when the identity insert loses a race", async () => {
    const repository = createRepository({
      createEmailIdentity: vi.fn().mockResolvedValue(null),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithTicket(input, { repository, now: NOW })
    ).rejects.toMatchObject({ code: "identity_conflict" });
    // 事务回滚：createUser 的写入不会留下只有 legacy 字段的 orphan account
    expect(repository.completeChallenge).not.toHaveBeenCalled();
  });

  it("rejects registration without a verified challenge", async () => {
    const repository = createRepository({
      findChallengeForTicket: vi.fn().mockResolvedValue(
        challengeRow({ verifiedAt: null, verifiedVia: null })
      ),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithTicket(input, { repository, now: NOW })
    ).rejects.toMatchObject({ code: "email_not_verified" });
    expect(repository.createUser).not.toHaveBeenCalled();
  });

  it("rejects a ticket whose hash does not match the challenge", async () => {
    const repository = createRepository({
      findChallengeForTicket: vi.fn().mockResolvedValue(
        challengeRow({ ticketHash: sha256("another-raw") })
      ),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithTicket(input, { repository, now: NOW })
    ).rejects.toMatchObject({ code: "ticket_invalid" });
  });

  it("rejects a ticket bound to a different email", async () => {
    const repository = createRepository({
      findChallengeForTicket: vi.fn().mockResolvedValue(
        challengeRow({ target: "other@example.com" })
      ),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithTicket(input, { repository, now: NOW })
    ).rejects.toMatchObject({ code: "ticket_invalid" });
  });

  it("rejects an already-consumed ticket", async () => {
    const repository = createRepository({
      findChallengeForTicket: vi.fn().mockResolvedValue(
        challengeRow({
          ticketConsumedAt: new Date("2026-08-06T11:55:00.000Z"),
        })
      ),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithTicket(input, { repository, now: NOW })
    ).rejects.toMatchObject({ code: "ticket_consumed" });
  });

  it("rejects an expired ticket", async () => {
    const repository = createRepository({
      findChallengeForTicket: vi.fn().mockResolvedValue(
        challengeRow({
          ticketExpiresAt: new Date("2026-08-06T11:59:00.000Z"),
        })
      ),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithTicket(input, { repository, now: NOW })
    ).rejects.toMatchObject({ code: "ticket_expired" });
  });

  it("rejects a malformed ticket", async () => {
    const repository = createRepository();
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithTicket(
        { ...input, ticket: "no-dot-format" },
        { repository, now: NOW }
      )
    ).rejects.toMatchObject({ code: "ticket_invalid" });
  });

  it("does not create a user when the atomic ticket claim loses a race", async () => {
    const repository = createRepository({
      consumeTicket: vi.fn().mockResolvedValue(false),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithTicket(input, { repository, now: NOW })
    ).rejects.toMatchObject({ code: "ticket_consumed" });
    expect(repository.createUser).not.toHaveBeenCalled();
  });

  it("rejects registration when no default credential profile is available", async () => {
    const repository = createRepository({
      findDefaultCredentialProfile: vi.fn().mockResolvedValue(null),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithTicket(input, { repository, now: NOW })
    ).rejects.toMatchObject({ code: "profile_unavailable" });
    expect(repository.createUser).not.toHaveBeenCalled();
  });
});
