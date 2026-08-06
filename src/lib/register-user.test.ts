import { describe, expect, it, vi } from "vitest";
import {
  RegistrationError,
  registerUserWithTicket,
  type ChallengeTicketRow,
  type RegistrationRepository,
} from "@/lib/register-user";
import { sha256 } from "@/lib/auth-challenge";

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

function challengeRow(
  overrides: Partial<ChallengeTicketRow> = {}
): ChallengeTicketRow {
  return {
    id: CHALLENGE_ID,
    email: input.email,
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
    findUserByEmail: vi.fn().mockResolvedValue(null),
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

  it("rejects an email that is already registered", async () => {
    const repository = createRepository({
      findUserByEmail: vi.fn().mockResolvedValue({ id: "existing" }),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithTicket(input, { repository, now: NOW })
    ).rejects.toEqual(
      new RegistrationError("email_exists", "该邮箱已被注册")
    );
    expect(repository.consumeTicket).not.toHaveBeenCalled();
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
        challengeRow({ email: "other@example.com" })
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
