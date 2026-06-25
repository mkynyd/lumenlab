import { USER_API_KEYS_ENABLED } from "@/lib/config";

export type ProviderName = "deepseek" | "minimax" | "mineru" | "bailian";

type ProviderAccessRecord = {
  accessStatus: string;
  credentialProfile: {
    status: string;
    credentials: ReadonlyArray<{
      provider: string;
      status: string;
      encryptedKey: string;
    }>;
  } | null;
};

export interface ProviderAccessRepository {
  findAccess(userId: string): Promise<ProviderAccessRecord | null>;
}

export interface UserApiKeyRepository {
  findUserApiKey(
    userId: string,
    provider: ProviderName
  ): Promise<{ encryptedKey: string } | null>;
}

export type ProviderAccessErrorCode =
  | "access_unavailable"
  | "access_revoked"
  | "profile_disabled"
  | "credential_unavailable"
  | "credential_decrypt_failed";

export class ProviderAccessError extends Error {
  constructor(
    public readonly code: ProviderAccessErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ProviderAccessError";
  }
}

export async function resolveProviderApiKey(
  userId: string,
  provider: ProviderName,
  options: {
    repository: ProviderAccessRepository;
    decryptKey: (encryptedKey: string) => string;
    userApiKeyRepository?: UserApiKeyRepository;
  }
): Promise<string> {
  // Self-hosting mode: prefer user-supplied API keys.
  if (USER_API_KEYS_ENABLED && options.userApiKeyRepository) {
    const userKey = await options.userApiKeyRepository.findUserApiKey(
      userId,
      provider
    );
    if (userKey) {
      try {
        return await options.decryptKey(userKey.encryptedKey);
      } catch {
        // Fall through to central credentials if the user key is corrupted.
      }
    }
  }

  const access = await options.repository.findAccess(userId);
  if (!access?.credentialProfile) {
    throw new ProviderAccessError(
      "access_unavailable",
      "当前账户没有可用的 Alpha 访问配置"
    );
  }
  if (access.accessStatus !== "active") {
    throw new ProviderAccessError("access_revoked", "当前账户访问已被撤销");
  }
  if (access.credentialProfile.status !== "active") {
    throw new ProviderAccessError(
      "profile_disabled",
      "当前服务配置已停用"
    );
  }

  const credential = access.credentialProfile.credentials.find(
    (candidate) =>
      candidate.provider === provider && candidate.status === "active"
  );
  if (!credential) {
    throw new ProviderAccessError(
      "credential_unavailable",
      `当前账户没有可用的 ${provider} 服务配置`
    );
  }

  try {
    return options.decryptKey(credential.encryptedKey);
  } catch {
    throw new ProviderAccessError(
      "credential_decrypt_failed",
      "服务密钥暂时不可用"
    );
  }
}
