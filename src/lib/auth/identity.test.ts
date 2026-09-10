import { describe, expect, it, vi } from "vitest";
import {
  checkEmailIdentityAvailability,
  resolveEmailIdentity,
  resolveEmailVerificationState,
  type AuthIdentityRepository,
  type AuthIdentityRow,
  type LegacyEmailUserRow,
} from "@/lib/auth/identity";

const NORMALIZED = "user@example.com";

function identityRow(overrides: Partial<AuthIdentityRow> = {}): AuthIdentityRow {
  return {
    id: "identity-1",
    userId: "user-1",
    type: "email",
    provider: "local",
    providerAccountId: NORMALIZED,
    verifiedAt: new Date("2026-08-01T00:00:00.000Z"),
    verificationSource: "legacy",
    ...overrides,
  };
}

function legacyUser(
  overrides: Partial<LegacyEmailUserRow> = {}
): LegacyEmailUserRow {
  return {
    id: "user-1",
    email: NORMALIZED,
    emailVerifiedAt: new Date("2026-08-01T00:00:00.000Z"),
    emailVerificationSource: "legacy",
    ...overrides,
  };
}

function createRepository(
  overrides: Partial<AuthIdentityRepository> = {}
): AuthIdentityRepository {
  return {
    findEmailIdentity: vi.fn().mockResolvedValue(null),
    createEmailIdentity: vi.fn().mockResolvedValue(null),
    findEmailIdentityByUserId: vi.fn().mockResolvedValue(null),
    getUserByNormalizedEmail: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("resolveEmailIdentity", () => {
  it("normalizes the identifier before every lookup", async () => {
    const repository = createRepository();
    await resolveEmailIdentity("  User@Example.COM ", repository);

    expect(repository.findEmailIdentity).toHaveBeenCalledWith(NORMALIZED);
    expect(repository.getUserByNormalizedEmail).toHaveBeenCalledWith(NORMALIZED);
  });

  it("uses the AuthIdentity as the source of truth", async () => {
    const repository = createRepository({
      findEmailIdentity: vi.fn().mockResolvedValue(identityRow()),
      getUserByNormalizedEmail: vi.fn().mockResolvedValue(legacyUser()),
    });

    const result = await resolveEmailIdentity("user@example.com", repository);

    expect(result).toMatchObject({
      kind: "resolved",
      userId: "user-1",
      selfHealed: false,
    });
    expect(repository.createEmailIdentity).not.toHaveBeenCalled();
  });

  it("self-heals a legacy-only account created during the migration window", async () => {
    const repository = createRepository({
      getUserByNormalizedEmail: vi.fn().mockResolvedValue(legacyUser()),
      createEmailIdentity: vi
        .fn()
        .mockImplementation(async (input: { userId: string }) =>
          identityRow({ userId: input.userId })
        ),
    });

    const result = await resolveEmailIdentity("USER@example.com", repository);

    expect(repository.createEmailIdentity).toHaveBeenCalledWith({
      userId: "user-1",
      providerAccountId: NORMALIZED,
      verifiedAt: legacyUser().emailVerifiedAt,
      verificationSource: "legacy",
    });
    expect(result).toMatchObject({
      kind: "resolved",
      userId: "user-1",
      selfHealed: true,
    });
  });

  it("re-reads the identity when a concurrent request wins the self-heal race", async () => {
    const findEmailIdentity = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(identityRow());
    const repository = createRepository({
      findEmailIdentity,
      getUserByNormalizedEmail: vi.fn().mockResolvedValue(legacyUser()),
      createEmailIdentity: vi.fn().mockResolvedValue(null),
    });

    const result = await resolveEmailIdentity(NORMALIZED, repository);

    expect(result).toMatchObject({
      kind: "resolved",
      userId: "user-1",
      selfHealed: false,
    });
  });

  it("stops when the identity and the legacy user point at different accounts", async () => {
    const repository = createRepository({
      findEmailIdentity: vi.fn().mockResolvedValue(
        identityRow({ userId: "user-a" })
      ),
      getUserByNormalizedEmail: vi.fn().mockResolvedValue(
        legacyUser({ id: "user-b" })
      ),
    });

    const result = await resolveEmailIdentity(NORMALIZED, repository);

    expect(result).toEqual({
      kind: "ambiguous",
      identityUserIds: ["user-a"],
      legacyUserId: "user-b",
    });
    expect(repository.createEmailIdentity).not.toHaveBeenCalled();
  });

  it("returns not_found for an unknown email", async () => {
    const repository = createRepository();
    const result = await resolveEmailIdentity("ghost@example.com", repository);

    expect(result).toEqual({ kind: "not_found" });
  });

  it("returns not_found for an empty identifier without touching the database", async () => {
    const repository = createRepository();
    const result = await resolveEmailIdentity("   ", repository);

    expect(result).toEqual({ kind: "not_found" });
    expect(repository.findEmailIdentity).not.toHaveBeenCalled();
  });
});

describe("checkEmailIdentityAvailability", () => {
  it("reports an untouched email as available", async () => {
    const repository = createRepository();
    const result = await checkEmailIdentityAvailability(
      "fresh@example.com",
      repository
    );

    expect(result).toEqual({ kind: "available", legacyUserId: null });
  });

  it("reports an email owned by an identity as taken", async () => {
    const repository = createRepository({
      findEmailIdentity: vi.fn().mockResolvedValue(identityRow()),
    });

    const result = await checkEmailIdentityAvailability(NORMALIZED, repository);

    expect(result).toEqual({
      kind: "taken",
      userId: "user-1",
      verified: true,
    });
  });

  it("reports a legacy-only account as taken (migration window)", async () => {
    const repository = createRepository({
      getUserByNormalizedEmail: vi.fn().mockResolvedValue(
        legacyUser({ id: "legacy-user" })
      ),
    });

    const result = await checkEmailIdentityAvailability(NORMALIZED, repository);

    expect(result).toEqual({
      kind: "taken",
      userId: "legacy-user",
      verified: true,
    });
    // 纯校验，不写库：注册事务内调用不会被自身写入干扰
    expect(repository.createEmailIdentity).not.toHaveBeenCalled();
  });

  it("reports a legacy account whose identity was never verified as unverified", async () => {
    const repository = createRepository({
      getUserByNormalizedEmail: vi.fn().mockResolvedValue(
        legacyUser({ emailVerifiedAt: null, emailVerificationSource: "none" })
      ),
      findEmailIdentityByUserId: vi
        .fn()
        .mockResolvedValue(identityRow({ verifiedAt: null })),
    });

    const result = await checkEmailIdentityAvailability(NORMALIZED, repository);

    expect(result).toMatchObject({ kind: "taken", verified: false });
  });

  it("reports a cross-account collision as a conflict", async () => {
    const repository = createRepository({
      getUserByNormalizedEmail: vi.fn().mockResolvedValue(
        legacyUser({ id: "legacy-user" })
      ),
      findEmailIdentity: vi.fn().mockResolvedValue(
        identityRow({ userId: "other-user" })
      ),
    });

    const result = await checkEmailIdentityAvailability(NORMALIZED, repository);

    expect(result).toEqual({ kind: "conflict" });
  });

  it("reports a conflict when the account already maps to another email", async () => {
    const repository = createRepository({
      getUserByNormalizedEmail: vi.fn().mockResolvedValue(
        legacyUser({ id: "legacy-user" })
      ),
      findEmailIdentityByUserId: vi
        .fn()
        .mockResolvedValue(
          identityRow({ providerAccountId: "other@example.com" })
        ),
    });

    const result = await checkEmailIdentityAvailability(NORMALIZED, repository);

    expect(result).toEqual({ kind: "conflict" });
  });
});

describe("resolveEmailVerificationState", () => {
  it("reads the verification state from the email identity", async () => {
    const repository = createRepository({
      findEmailIdentity: vi.fn().mockResolvedValue(identityRow()),
    });

    const state = await resolveEmailVerificationState(NORMALIZED, repository);

    expect(state).toEqual({
      verifiedAt: new Date("2026-08-01T00:00:00.000Z"),
      source: "identity",
    });
  });

  it("falls back to the legacy User field when no identity exists yet", async () => {
    const repository = createRepository({
      getUserByNormalizedEmail: vi
        .fn()
        .mockResolvedValue(legacyUser({ emailVerifiedAt: null })),
    });

    const state = await resolveEmailVerificationState(NORMALIZED, repository);

    expect(state).toEqual({ verifiedAt: null, source: "legacy-user" });
  });
});
