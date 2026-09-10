/**
 * 密码重设领域逻辑。
 *
 * 请求重设不在此层：由路由解析身份（不存在返回统一成功，防枚举）后
 * 调用 sendPasswordResetEmail。confirm 在事务内原子消费一次性 token，
 * 通过邮箱身份层解析到账户后更新 `User.passwordHash` + `User.passwordChangedAt`
 * （旧 JWT 经 pwchg claim 失效）。
 *
 * 密码属于账户级凭证：无论改密入口来自邮件链接还是登录态设置页，写入的都是
 * `User.passwordHash`，不会出现“每个 Identity 一套密码”。
 */

import { sha256, splitRawToken } from "@/lib/auth-challenge";
import {
  resolveEmailIdentity,
  type AuthIdentityRepository,
} from "@/lib/auth/identity";

export interface PasswordResetTokenRow {
  /** 通用化的投递目标（email channel 下即规范化邮箱） */
  target: string;
  tokenHash: string | null;
  tokenExpiresAt: Date | null;
  tokenConsumedAt: Date | null;
  consumedAt: Date | null;
}

export interface PasswordResetRepository extends AuthIdentityRepository {
  /** GET 校验链接用：不消费，仅读取 */
  findResetToken(challengeId: string): Promise<PasswordResetTokenRow | null>;
  /** 原子 claim：id + tokenHash 匹配 + 未消费 + 未过期 + 挑战未关闭 */
  claimResetToken(input: {
    challengeId: string;
    tokenHash: string;
    now: Date;
  }): Promise<boolean>;
  updatePassword(
    userId: string,
    passwordHash: string,
    changedAt: Date
  ): Promise<void>;
  transaction<T>(
    operation: (repository: PasswordResetRepository) => Promise<T>
  ): Promise<T>;
}

export type ResetConfirmResult =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid" | "expired" | "used" | "user_not_found" | "identity_conflict";
    };

export async function confirmPasswordReset(
  input: { ticket: string; passwordHash: string },
  options: { repository: PasswordResetRepository; now?: Date }
): Promise<ResetConfirmResult> {
  const now = options.now || new Date();
  const split = splitRawToken(input.ticket);
  if (!split) return { ok: false, reason: "invalid" };

  return options.repository.transaction(async (repository) => {
    const challenge = await repository.findResetToken(split.id);
    if (!challenge || challenge.tokenHash !== sha256(split.raw)) {
      return { ok: false, reason: "invalid" };
    }
    if (challenge.tokenConsumedAt) return { ok: false, reason: "used" };
    if (!challenge.tokenExpiresAt || challenge.tokenExpiresAt.getTime() < now.getTime()) {
      return { ok: false, reason: "expired" };
    }

    const claimed = await repository.claimResetToken({
      challengeId: split.id,
      tokenHash: sha256(split.raw),
      now,
    });
    if (!claimed) return { ok: false, reason: "used" };

    // 身份层解析（AuthIdentity 优先，兼容窗口内 fallback legacy User.email）
    const resolution = await resolveEmailIdentity(challenge.target, repository);
    if (resolution.kind === "ambiguous") {
      return { ok: false, reason: "identity_conflict" };
    }
    if (resolution.kind === "not_found") {
      return { ok: false, reason: "user_not_found" };
    }

    // 密码落点始终是账户主键 User.id（不是 identity id）
    await repository.updatePassword(resolution.userId, input.passwordHash, now);
    return { ok: true };
  });
}
