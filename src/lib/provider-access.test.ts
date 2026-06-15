import { describe, expect, it, vi } from "vitest";
import {
  ProviderAccessError,
  resolveProviderApiKey,
  type ProviderAccessRepository,
} from "@/lib/provider-access";

function repository(
  record: Awaited<ReturnType<ProviderAccessRepository["findAccess"]>>
): ProviderAccessRepository {
  return {
    findAccess: vi.fn().mockResolvedValue(record),
  };
}

describe("resolveProviderApiKey", () => {
  it("decrypts an active credential for an active user and profile", async () => {
    const decryptKey = vi.fn().mockReturnValue("provider-secret");
    const result = await resolveProviderApiKey(
      "user-1",
      "deepseek",
      {
        repository: repository({
          accessStatus: "active",
          credentialProfile: {
            status: "active",
            credentials: [
              {
                provider: "deepseek",
                status: "active",
                encryptedKey: "encrypted",
              },
            ],
          },
        }),
        decryptKey,
      }
    );

    expect(result).toBe("provider-secret");
    expect(decryptKey).toHaveBeenCalledWith("encrypted");
  });

  it.each([
    [
      null,
      "access_unavailable",
    ],
    [
      {
        accessStatus: "revoked",
        credentialProfile: {
          status: "active",
          credentials: [],
        },
      },
      "access_revoked",
    ],
    [
      {
        accessStatus: "active",
        credentialProfile: {
          status: "disabled",
          credentials: [],
        },
      },
      "profile_disabled",
    ],
    [
      {
        accessStatus: "active",
        credentialProfile: {
          status: "active",
          credentials: [],
        },
      },
      "credential_unavailable",
    ],
  ] as const)("rejects unavailable access", async (record, code) => {
    await expect(
      resolveProviderApiKey("user-1", "deepseek", {
        repository: repository(record),
        decryptKey: vi.fn(),
      })
    ).rejects.toEqual(expect.objectContaining({ code }));
  });

  it("wraps decryption failures without exposing secret details", async () => {
    await expect(
      resolveProviderApiKey("user-1", "deepseek", {
        repository: repository({
          accessStatus: "active",
          credentialProfile: {
            status: "active",
            credentials: [
              {
                provider: "deepseek",
                status: "active",
                encryptedKey: "corrupt",
              },
            ],
          },
        }),
        decryptKey: () => {
          throw new Error("ciphertext details");
        },
      })
    ).rejects.toEqual(
      new ProviderAccessError(
        "credential_decrypt_failed",
        "服务密钥暂时不可用"
      )
    );
  });
});
