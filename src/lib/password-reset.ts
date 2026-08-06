/**
 * 密码重设领域逻辑。
 *
 * 请求重设不在此层：由路由查用户（不存在返回统一成功，防枚举）后
 * 调用 sendPasswordResetEmail。confirm 在事务内原子消费一次性 token，
 * 更新 passwordHash + passwordChangedAt（旧 JWT 经 pwchg claim 失效）。
 */

import { sha256, splitRawToken } from "@/lib/auth-challenge";

export interface PasswordResetTokenRow {
  email: string;
  tokenHash: string | null;
  tokenExpiresAt: Date | null;
  tokenConsumedAt: Date | null;
  consumedAt: Date | null;
}

export interface PasswordResetRepository {
  /** GET 校验链接用：不消费，仅读取 */
  findResetToken(challengeId: string): Promise<PasswordResetTokenRow | null>;
  /** 原子 claim：id + tokenHash 匹配 + 未消费 + 未过期 + 挑战未关闭 */
  claimResetToken(input: {
    challengeId: string;
    tokenHash: string;
    now: Date;
  }): Promise<boolean>;
  findUserByEmail(email: string): Promise<{ id: string } | null>;
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
  | { ok: false; reason: "invalid" | "expired" | "used" | "user_not_found" };

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

    const user = await repository.findUserByEmail(challenge.email);
    if (!user) return { ok: false, reason: "user_not_found" };

    await repository.updatePassword(user.id, input.passwordHash, now);
    return { ok: true };
  });
}
