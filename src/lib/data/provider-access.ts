import "server-only";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import {
  resolveProviderApiKey,
  type ProviderAccessRepository,
  type ProviderName,
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

export function getProviderApiKey(
  userId: string,
  provider: ProviderName
): Promise<string> {
  return resolveProviderApiKey(userId, provider, {
    repository,
    decryptKey: decrypt,
  });
}

