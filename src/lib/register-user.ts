import {
  digestRegistrationCode,
  evaluateRegistrationCode,
} from "@/lib/registration-code";

type CredentialState = {
  provider: string;
  status: string;
};

type RegistrationCodeRecord = {
  id: string;
  status: string;
  redemptionCount: number;
  maxRedemptions: number;
  expiresAt: Date | null;
  credentialProfile: {
    id: string;
    status: string;
    credentials: CredentialState[];
  };
};

type RegisteredUser = {
  id: string;
  email: string;
  name: string | null;
};

export interface RegistrationRepository {
  findUserByEmail(email: string): Promise<{ id: string } | null>;
  findCodeByDigest(digest: string): Promise<RegistrationCodeRecord | null>;
  consumeCode(codeId: string, now: Date): Promise<boolean>;
  createUser(input: {
    email: string;
    passwordHash: string;
    credentialProfileId: string;
  }): Promise<RegisteredUser>;
  createRedemption(input: { codeId: string; userId: string }): Promise<void>;
  transaction<T>(
    operation: (repository: RegistrationRepository) => Promise<T>
  ): Promise<T>;
}

export type RegistrationErrorCode =
  | "email_exists"
  | "invalid_code"
  | "code_exhausted"
  | "profile_unavailable";

export class RegistrationError extends Error {
  constructor(
    public readonly code: RegistrationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "RegistrationError";
  }
}

export async function registerUserWithCode(
  input: {
    email: string;
    passwordHash: string;
    registrationCode: string;
  },
  options: {
    repository: RegistrationRepository;
    pepper: string;
    now?: Date;
  }
): Promise<RegisteredUser> {
  const now = options.now || new Date();
  const digest = digestRegistrationCode(
    input.registrationCode,
    options.pepper
  );

  return options.repository.transaction(async (repository) => {
    const existing = await repository.findUserByEmail(input.email);
    if (existing) {
      throw new RegistrationError("email_exists", "该邮箱已被注册");
    }

    const code = await repository.findCodeByDigest(digest);
    if (!code) {
      throw new RegistrationError("invalid_code", "注册码无效或不可用");
    }

    const evaluation = evaluateRegistrationCode(code, now);
    if (!evaluation.allowed) {
      throw new RegistrationError(
        evaluation.reason === "exhausted" ? "code_exhausted" : "invalid_code",
        evaluation.reason === "exhausted"
          ? "注册码使用次数已达上限"
          : "注册码无效或不可用"
      );
    }

    const hasDeepSeek = code.credentialProfile.credentials.some(
      (credential) =>
        credential.provider === "deepseek" && credential.status === "active"
    );
    if (code.credentialProfile.status !== "active" || !hasDeepSeek) {
      throw new RegistrationError(
        "profile_unavailable",
        "注册码对应的服务配置暂不可用"
      );
    }

    const consumed = await repository.consumeCode(code.id, now);
    if (!consumed) {
      throw new RegistrationError(
        "code_exhausted",
        "注册码使用次数已达上限"
      );
    }

    const user = await repository.createUser({
      email: input.email,
      passwordHash: input.passwordHash,
      credentialProfileId: code.credentialProfile.id,
    });
    await repository.createRedemption({ codeId: code.id, userId: user.id });
    return user;
  });
}
