import { describe, expect, it, vi } from "vitest";
import {
  resolveProviderApiKey,
  type ProviderAccessRepository,
  type UserApiKeyRepository,
} from "@/lib/provider-access";

// Enable the self-hosting flag for all tests in this file.
vi.mock("@/lib/config", () => ({
  USER_API_KEYS_ENABLED: true,
}));

function repository(
  record: Awaited<ReturnType<ProviderAccessRepository["findAccess"]>>
): ProviderAccessRepository {
  return {
    findAccess: vi.fn().mockResolvedValue(record),
  };
}

function userKeyRepository(
  record: Awaited<ReturnType<UserApiKeyRepository["findUserApiKey"]>>
): UserApiKeyRepository {
  return {
    findUserApiKey: vi.fn().mockResolvedValue(record),
  };
}

describe("resolveProviderApiKey with user API keys enabled", () => {
  it("returns the user's key when available", async () => {
    const decryptKey = vi.fn().mockReturnValue("user-secret");
    const centralRepo = repository({
      accessStatus: "active",
      credentialProfile: {
        status: "active",
        credentials: [
          {
            provider: "deepseek",
            status: "active",
            encryptedKey: "central-encrypted",
          },
        ],
      },
    });
    const userRepo = userKeyRepository({
      encryptedKey: "user-encrypted",
    });

    const result = await resolveProviderApiKey("user-1", "deepseek", {
      repository: centralRepo,
      decryptKey,
      userApiKeyRepository: userRepo,
    });

    expect(result).toBe("user-secret");
    expect(decryptKey).toHaveBeenCalledWith("user-encrypted");
    expect(centralRepo.findAccess).not.toHaveBeenCalled();
  });

  it("falls back to central credentials when user has no custom key", async () => {
    const decryptKey = vi.fn().mockReturnValue("central-secret");
    const centralRepo = repository({
      accessStatus: "active",
      credentialProfile: {
        status: "active",
        credentials: [
          {
            provider: "deepseek",
            status: "active",
            encryptedKey: "central-encrypted",
          },
        ],
      },
    });
    const userRepo = userKeyRepository(null);

    const result = await resolveProviderApiKey("user-1", "deepseek", {
      repository: centralRepo,
      decryptKey,
      userApiKeyRepository: userRepo,
    });

    expect(result).toBe("central-secret");
    expect(userRepo.findUserApiKey).toHaveBeenCalledWith("user-1", "deepseek");
    expect(centralRepo.findAccess).toHaveBeenCalledWith("user-1");
  });

  it("falls back to central credentials when user key decryption fails", async () => {
    const decryptKey = vi
      .fn()
      .mockRejectedValueOnce(new Error("user decrypt failed"))
      .mockReturnValueOnce("central-secret");
    const centralRepo = repository({
      accessStatus: "active",
      credentialProfile: {
        status: "active",
        credentials: [
          {
            provider: "deepseek",
            status: "active",
            encryptedKey: "central-encrypted",
          },
        ],
      },
    });
    const userRepo = userKeyRepository({
      encryptedKey: "corrupt-user-encrypted",
    });

    const result = await resolveProviderApiKey("user-1", "deepseek", {
      repository: centralRepo,
      decryptKey,
      userApiKeyRepository: userRepo,
    });

    expect(result).toBe("central-secret");
  });
});
