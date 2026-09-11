/**
 * 认证服务层（server-only 装配点）。
 *
 * API route / NextAuth provider 只调用这里，不直接拼 `prisma.authIdentity.*`、
 * 邮箱规范化或 legacy fallback，保证登录、注册查重、验证邮件预检、忘记密码、
 * 修改密码走同一套身份解析规则。
 */

import "server-only";
import {
  authIdentityRepository,
} from "@/lib/data/auth-identity-repository";
import {
  checkIdentityAvailability,
  resolveIdentity,
  checkEmailIdentityAvailability,
  resolveEmailIdentity,
  resolveEmailVerificationState,
  type EmailIdentityAvailability,
  type EmailIdentityResolution,
  type EmailVerificationState,
} from "@/lib/auth/identity";

export { authIdentityRepository };
export type { EmailIdentityAvailability, EmailIdentityResolution, EmailVerificationState };

/** 按邮箱解析认证身份（AuthIdentity 优先，Expand 阶段兼容 legacy User.email） */
export function resolveEmail(email: string): Promise<EmailIdentityResolution> {
  return resolveEmailIdentity(email, authIdentityRepository);
}

/** 写入前的邮箱占用检查（不触发 self-heal） */
export function checkEmailAvailability(
  email: string
): Promise<EmailIdentityAvailability> {
  return checkEmailIdentityAvailability(email, authIdentityRepository);
}

/** 读取邮箱验证状态（email Identity 优先，未 self-heal 时回退 legacy 字段） */
export function readEmailVerificationState(
  email: string
): Promise<EmailVerificationState | null> {
  return resolveEmailVerificationState(email, authIdentityRepository);
}

export function resolveIdentifier(identifier: string) {
  return resolveIdentity(identifier, authIdentityRepository);
}
export function checkIdentifierAvailability(identifier: string) {
  return checkIdentityAvailability(identifier, authIdentityRepository);
}
