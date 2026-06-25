import "server-only";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { USER_API_KEYS_ENABLED } from "@/lib/config";
import {
  resolveProviderApiKey,
  type ProviderAccessRepository,
  type ProviderName,
  type UserApiKeyRepository,
} from "@/lib/provider-access";

const repository: ProviderAccessRepository = {
  findAccess(userId) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        accessStatus: true,
        credentialProfile: {
          select: {
            status: true,
            credentials: {
              select: {
                provider: true,
                status: true,
                encryptedKey: true,
              },
            },
          },
        },
      },
    });
  },
};

const userApiKeyRepository: UserApiKeyRepository = {
  findUserApiKey(userId, provider) {
    return prisma.apiKey.findUnique({
      where: { userId_provider: { userId, provider } },
      select: { encryptedKey: true },
    });
  },
};

export function getProviderApiKey(
  userId: string,
  provider: ProviderName
): Promise<string> {
  return resolveProviderApiKey(userId, provider, {
    repository,
    decryptKey: decrypt,
    userApiKeyRepository: USER_API_KEYS_ENABLED
      ? userApiKeyRepository
      : undefined,
  });
}

