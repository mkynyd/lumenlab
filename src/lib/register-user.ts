/**
 * 注册领域逻辑（邮箱验证版）。
 *
 * 注册凭证是验证挑战签发的**一次性票据**（`<challengeId>.<raw>`，DB 只存
 * sha256）：必须先完成邮箱验证拿到票据，注册事务内原子消费，防止"A 验证、
 * B 注册"与票据重放。新用户自动分配默认 CredentialProfile。
 */

import { sha256, splitRawToken } from "@/lib/auth-challenge";

type RegisteredUser = {
  id: string;
  email: string;
  name: string | null;
};

export interface ChallengeTicketRow {
  id: string;
  email: string;
  verifiedAt: Date | null;
  verifiedVia: string | null;
  ticketHash: string | null;
  ticketExpiresAt: Date | null;
  ticketConsumedAt: Date | null;
  consumedAt: Date | null;
}

export interface RegistrationRepository {
  findUserByEmail(email: string): Promise<{ id: string } | null>;
  /** 按票据定位验证挑战（票据未消费时的前置校验数据） */
  findChallengeForTicket(challengeId: string): Promise<ChallengeTicketRow | null>;
  /** 原子消费票据；失败表示已消费/过期/挑战已关闭 */
  consumeTicket(input: {
    challengeId: string;
    ticketHash: string;
    now: Date;
  }): Promise<boolean>;
  findDefaultCredentialProfile(): Promise<{ id: string } | null>;
  createUser(input: {
    email: string;
    passwordHash: string;
    credentialProfileId: string;
    emailVerifiedAt: Date;
    emailVerificationSource: string;
  }): Promise<RegisteredUser>;
  completeChallenge(challengeId: string, now: Date): Promise<void>;
  transaction<T>(
    operation: (repository: RegistrationRepository) => Promise<T>
  ): Promise<T>;
}

export type RegistrationErrorCode =
  | "email_exists"
  | "email_not_verified"
  | "ticket_invalid"
  | "ticket_expired"
  | "ticket_consumed"
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

export async function registerUserWithTicket(
  input: {
    email: string;
    passwordHash: string;
    ticket: string;
  },
  options: {
    repository: RegistrationRepository;
    now?: Date;
  }
): Promise<RegisteredUser> {
  const now = options.now || new Date();
  const split = splitRawToken(input.ticket);
  if (!split) {
    throw new RegistrationError("ticket_invalid", "验证已失效，请重新验证邮箱");
  }

  return options.repository.transaction(async (repository) => {
    const existing = await repository.findUserByEmail(input.email);
    if (existing) {
      throw new RegistrationError("email_exists", "该邮箱已被注册");
    }

    const challenge = await repository.findChallengeForTicket(split.id);
    if (!challenge) {
      throw new RegistrationError("ticket_invalid", "验证已失效，请重新验证邮箱");
    }
    // 票据与邮箱必须匹配；统一报错文案防探测
    if (
      challenge.email !== input.email ||
      !challenge.verifiedAt ||
      !challenge.verifiedVia
    ) {
      throw new RegistrationError(
        challenge.verifiedAt ? "ticket_invalid" : "email_not_verified",
        challenge.verifiedAt ? "验证已失效，请重新验证邮箱" : "请先完成邮箱验证"
      );
    }
    if (challenge.ticketHash !== sha256(split.raw)) {
      throw new RegistrationError("ticket_invalid", "验证已失效，请重新验证邮箱");
    }
    if (challenge.ticketConsumedAt) {
      throw new RegistrationError("ticket_consumed", "验证已失效，请重新验证邮箱");
    }
    if (
      !challenge.ticketExpiresAt ||
      challenge.ticketExpiresAt.getTime() < now.getTime()
    ) {
      throw new RegistrationError("ticket_expired", "验证已过期，请重新验证邮箱");
    }

    const consumed = await repository.consumeTicket({
      challengeId: split.id,
      ticketHash: sha256(split.raw),
      now,
    });
    if (!consumed) {
      throw new RegistrationError("ticket_consumed", "验证已失效，请重新验证邮箱");
    }

    const profile = await repository.findDefaultCredentialProfile();
    if (!profile) {
      throw new RegistrationError(
        "profile_unavailable",
        "注册服务暂不可用，请稍后再试"
      );
    }

    const user = await repository.createUser({
      email: input.email,
      passwordHash: input.passwordHash,
      credentialProfileId: profile.id,
      emailVerifiedAt: challenge.verifiedAt,
      emailVerificationSource: challenge.verifiedVia,
    });
    await repository.completeChallenge(split.id, now);
    return user;
  });
}
