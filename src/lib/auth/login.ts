/**
 * 邮箱 + 密码登录领域逻辑（Credentials Provider 的 authorize 实现）。
 *
 * 从 `auth.ts` 拆出，避免让这条安全敏感路径必须依赖 NextAuth 运行时才能测试。
 * 行为与迁移前完全一致：
 *   限流 → 账号解析 → bcrypt（账户不存在时走 dummy hash 保持时序）→ 邮箱验证 → 审计
 *
 * 身份模型（Phase 2）：先规范化邮箱或手机号，再通过统一 identity resolver
 * （AuthIdentity 为 Source of Truth）拿到 `User.id`；JWT 主键始终是 `User.id`。
 * `User.passwordHash` 仍是唯一的账户密码来源。
 */

import { CredentialsSignin } from "next-auth";
import bcrypt from "bcryptjs";
import { loginSchema } from "@/lib/validators";
import { prisma } from "@/lib/db";
import { buildUserAvatarUrl } from "@/lib/user-profile";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { parseLoginIdentifier, type IdentityType } from "@/lib/auth/identifier";
import { resolveIdentifier } from "@/lib/auth/service";

// 用于在用户不存在时执行一次耗时近似的 dummy bcrypt.compare，
// 防止攻击者通过响应时间枚举邮箱是否存在。
const DUMMY_HASH = bcrypt.hashSync("login-timing-dummy", 10);

/** 邮箱未验证时抛出，signIn 返回的 result.code 为 "email_not_verified" */
export class EmailNotVerifiedError extends CredentialsSignin {
  code = "email_not_verified";
}

export class IdentityNotVerifiedError extends CredentialsSignin {
  code = "identity_not_verified";
}

export function getClientIp(request: Request | undefined): string {
  const forwarded = request?.headers?.get?.("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request?.headers?.get?.("x-real-ip") ?? "unknown";
}

export async function recordLoginAttempt(
  identifier: string,
  ip: string,
  success: boolean,
  identityType: IdentityType = "email"
): Promise<void> {
  try {
    await prisma.loginAttempt.create({
      data: { email: identityType === "email" ? identifier : null, identifier, identityType, ip, success },
    });
  } catch {
    // 审计写入失败不应阻断登录流程
  }
}

export async function authorizeWithIdentifierPassword(
  credentials: Partial<Record<"identifier" | "email" | "password", unknown>> | undefined,
  request: Request | undefined
) {
  const parsed = loginSchema.safeParse(credentials);
  if (!parsed.success) return null;

  const identifier = parseLoginIdentifier(parsed.data.identifier ?? parsed.data.email)!;
  const target = identifier.providerAccountId;
  const password = parsed.data.password;
  const ip = getClientIp(request);

  // 按 IP + email 维度进行登录限流
  const rate = await checkRateLimit(
    `login:${ip}:${target}`,
    RateLimits.LOGIN.max,
    RateLimits.LOGIN.window
  );
  if (!rate.allowed) {
    await recordLoginAttempt(target, ip, false, identifier.type);
    return null;
  }

  // 身份层解析：AuthIdentity 为 Source of Truth；migration 窗口内由旧 Release
  // 创建、只有 legacy `User.email` 的账户会在这里幂等 self-heal 出 email Identity。
  const resolution = await resolveIdentifier(target);
  const account =
    resolution.kind === "resolved"
      ? await prisma.user.findUnique({
          where: { id: resolution.userId },
          select: {
            id: true,
            email: true,
            name: true,
            passwordHash: true,
            avatarPreset: true,
            avatarStorageProvider: true,
            avatarObjectKey: true,
            avatarMimeType: true,
            avatarUpdatedAt: true,
            passwordChangedAt: true,
          },
        })
      : null;

  // 无论账户是否存在都执行一次 bcrypt.compare，保持响应时间接近。
  const valid = account
    ? await bcrypt.compare(password, account.passwordHash)
    : await bcrypt.compare(password, DUMMY_HASH);

  if (!valid) {
    await recordLoginAttempt(target, ip, false, identifier.type);
    return null;
  }

  // 上面 valid 为 true 时 account 一定存在；此处 guard 用于类型安全。
  if (!account) {
    return null;
  }

  // 邮箱验证状态优先读 email Identity 的 verifiedAt（resolution 已带回），
  // 兼容窗口内 legacy-only 账户回退 `User.emailVerifiedAt`
  // （老用户由 20260806 迁移 backfill 标记为 legacy 已验证）。
  // 放在密码比较之后，保持 dummy-hash 时序防护。
  const verifiedAt = resolution.kind === "resolved" ? resolution.identity.verifiedAt : null;
  if (!verifiedAt) {
    await recordLoginAttempt(target, ip, false, identifier.type);
    throw identifier.type === "email" ? new EmailNotVerifiedError() : new IdentityNotVerifiedError();
  }

  await recordLoginAttempt(target, ip, true, identifier.type);

  return {
    id: account.id,
    email: account.email,
    name: account.name,
    avatarPreset: account.avatarPreset,
    image: buildUserAvatarUrl(account),
    // 密码版本：重设密码后旧 JWT 经 pwchg claim 失效
    passwordChangedAt: account.passwordChangedAt?.getTime() ?? null,
  };
}

/** Phase 1 import compatibility; remove with legacy email credential payload. */
export const authorizeWithEmailPassword = authorizeWithIdentifierPassword;
