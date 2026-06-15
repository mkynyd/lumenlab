import { describe, expect, it, vi } from "vitest";
import {
  RegistrationError,
  registerUserWithCode,
  type RegistrationRepository,
} from "@/lib/register-user";

const input = {
  email: "alpha@example.com",
  passwordHash: "hashed-password",
  registrationCode: "ALPHA-7X9P",
};

function createRepository(
  overrides: Partial<RegistrationRepository> = {}
): RegistrationRepository {
  return {
    findUserByEmail: vi.fn().mockResolvedValue(null),
    findCodeByDigest: vi.fn().mockResolvedValue({
      id: "code-1",
      status: "active",
      redemptionCount: 0,
      maxRedemptions: 2,
      expiresAt: null,
      credentialProfile: {
        id: "profile-1",
        status: "active",
        credentials: [{ provider: "deepseek", status: "active" }],
      },
    }),
    consumeCode: vi.fn().mockResolvedValue(true),
    createUser: vi.fn().mockResolvedValue({
      id: "user-1",
      email: input.email,
      name: null,
    }),
    createRedemption: vi.fn().mockResolvedValue(undefined),
    transaction: async () => {
      throw new Error("transaction must be replaced by the test");
    },
    ...overrides,
  };
}

describe("registerUserWithCode", () => {
  it("atomically consumes the code and binds the user to its credential profile", async () => {
    const repository = createRepository();
    repository.transaction = async (operation) => operation(repository);

    const user = await registerUserWithCode(input, {
      repository,
      pepper: "test-pepper",
      now: new Date("2026-06-15T12:00:00.000Z"),
    });

    expect(repository.consumeCode).toHaveBeenCalledWith(
      "code-1",
      new Date("2026-06-15T12:00:00.000Z")
    );
    expect(repository.createUser).toHaveBeenCalledWith({
      email: input.email,
      passwordHash: input.passwordHash,
      credentialProfileId: "profile-1",
    });
    expect(repository.createRedemption).toHaveBeenCalledWith({
      codeId: "code-1",
      userId: "user-1",
    });
    expect(user).toEqual({
      id: "user-1",
      email: input.email,
      name: null,
    });
  });

  it("rejects an unknown registration code", async () => {
    const repository = createRepository({
      findCodeByDigest: vi.fn().mockResolvedValue(null),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithCode(input, {
        repository,
        pepper: "test-pepper",
      })
    ).rejects.toEqual(
      new RegistrationError("invalid_code", "注册码无效或不可用")
    );
  });

  it("rejects a credential profile without an active DeepSeek key", async () => {
    const repository = createRepository({
      findCodeByDigest: vi.fn().mockResolvedValue({
        id: "code-1",
        status: "active",
        redemptionCount: 0,
        maxRedemptions: 2,
        expiresAt: null,
        credentialProfile: {
          id: "profile-1",
          status: "active",
          credentials: [{ provider: "deepseek", status: "disabled" }],
        },
      }),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithCode(input, {
        repository,
        pepper: "test-pepper",
      })
    ).rejects.toMatchObject({ code: "profile_unavailable" });
  });

  it("does not create a user when the atomic redemption loses a race", async () => {
    const repository = createRepository({
      consumeCode: vi.fn().mockResolvedValue(false),
    });
    repository.transaction = async (operation) => operation(repository);

    await expect(
      registerUserWithCode(input, {
        repository,
        pepper: "test-pepper",
      })
    ).rejects.toMatchObject({ code: "code_exhausted" });
    expect(repository.createUser).not.toHaveBeenCalled();
  });
});
