/**
 * 注册领域逻辑（邮箱验证版）。
 *
 * 注册凭证是验证挑战签发的**一次性票据**（`<challengeId>.<raw>`，DB 只存
 * sha256）：必须先完成邮箱验证拿到票据，注册事务内原子消费，防止"A 验证、
 * B 注册"与票据重放。新用户自动分配默认 CredentialProfile。
 *
 * 身份模型（第一阶段）：`User` 仍表示 LumenLab 内部账户，业务数据只关联
 * `User.id`；`AuthIdentity` 表示“用户可以用什么标识找到这个账户”。
 * 因此事务内必须同时写入：
 *   - `User`（含 legacy 兼容字段 email/emailVerifiedAt/emailVerificationSource）
 *   - email `AuthIdentity`（provider=local, providerAccountId=normalized email）
 * 两步同事务，任一步失败整体回滚，不会出现“User 已创建但 Identity 缺失”的
 * orphan account，也不会出现 Identity 指向不存在的 User。
 *
 * 邮箱唯一性的权威来源已逐步切到 AuthIdentity；Expand 阶段仍需识别只有 legacy
 * `User.email` 的历史账户（见 `assertEmailAvailable`）。
 */

import { sha256, splitRawToken } from "@/lib/auth-challenge";
import { normalizeEmail } from "@/lib/auth/identifier";
import {
  checkEmailIdentityAvailability,
  type AuthIdentityRepository,
} from "@/lib/auth/identity";

type RegisteredUser = {
  id: string;
  email: string;
  name: string | null;
};

export interface ChallengeTicketRow {
  id: string;
  /** 通用化的投递目标（email channel 下即规范化邮箱） */
  target: string;
  verifiedAt: Date | null;
  verifiedVia: string | null;
  ticketHash: string | null;
  ticketExpiresAt: Date | null;
  ticketConsumedAt: Date | null;
  consumedAt: Date | null;
}

export interface RegistrationRepository extends AuthIdentityRepository {
  /** 按票据定位验证挑战（票据未消费时的前置校验数据） */
  findChallengeForTicket(challengeId: string): Promise<ChallengeTicketRow | null>;
  /** 原子消费票据；失败表示已消费/过期/挑战已关闭 */
  consumeTicket(input: {
    challengeId: string;
    ticketHash: string;
    now: Date;
  }): Promise<boolean>;
  findDefaultCredentialProfile(): Promise<{ id: string } | null>;
  /**
   * 创建 User 并写入 legacy 验证字段。
   * email Identity 由调用方在同一事务内通过 `createEmailIdentity` 补写。
   */
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
  | "profile_unavailable"
  | "identity_conflict";

export class RegistrationError extends Error {
  constructor(
    public readonly code: RegistrationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "RegistrationError";
  }
}

/**
 * 注册重复检查。
 *
 * AuthIdentity 优先；只有 legacy `User.email` 的历史账户（migration 与 Release
 * 切换窗口内由旧版本创建）也必须拦住，否则会出现同一邮箱两个账户。
 * 发现 identity 与 legacy 落到不同 User 时停止注册并上报，禁止静默合并。
 *
 * 邮箱验证发生在注册之前，此时**尚未**创建 AuthIdentity，因此“找不到 identity”
 * 是正常情况而不是冲突；真正的重复只由已存在的 User 账户判定。
 */
async function assertEmailAvailable(
  email: string,
  repository: RegistrationRepository
): Promise<void> {
  const availability = await checkEmailIdentityAvailability(email, repository);
  if (availability.kind === "conflict") {
    throw new RegistrationError(
      "identity_conflict",
      "该邮箱存在冲突的账户记录，请联系管理员处理"
    );
  }
  if (availability.kind === "taken") {
    // 未验证的账户同样算已注册：登录流程会用“未验证邮箱拒绝登录”给出准确提示。
    throw new RegistrationError("email_exists", "该邮箱已被注册");
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
  const email = normalizeEmail(input.email);
  const split = splitRawToken(input.ticket);
  if (!split) {
    throw new RegistrationError("ticket_invalid", "验证已失效，请重新验证邮箱");
  }

  return options.repository.transaction(async (repository) => {
    await assertEmailAvailable(email, repository);

    const challenge = await repository.findChallengeForTicket(split.id);
    if (!challenge) {
      throw new RegistrationError("ticket_invalid", "验证已失效，请重新验证邮箱");
    }
    // 票据与邮箱必须匹配；统一报错文案防探测
    if (
      challenge.target !== email ||
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

    const verificationSource = challenge.verifiedVia;
    const user = await repository.createUser({
      email,
      passwordHash: input.passwordHash,
      credentialProfileId: profile.id,
      emailVerifiedAt: challenge.verifiedAt,
      emailVerificationSource: verificationSource,
    });

    // 同一事务内创建 email Identity；唯一约束冲突会连带回滚上面的 User 创建，
    // 因此不会留下只有 legacy 字段的新账户。
    const identity = await repository.createEmailIdentity({
      userId: user.id,
      providerAccountId: email,
      verifiedAt: challenge.verifiedAt,
      verificationSource,
    });
    if (!identity) {
      throw new RegistrationError(
        "identity_conflict",
        "该邮箱已被注册，请直接登录或找回密码"
      );
    }

    await repository.completeChallenge(split.id, now);
    return user;
  });
}
