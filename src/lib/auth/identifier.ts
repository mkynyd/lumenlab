/**
 * 认证标识规范化（单一实现）。
 *
 * 认证、注册、密码重设等所有路径都必须经过这里，禁止各自实现不同的 normalize
 * 逻辑，否则会出现“登录能找到、注册却认为不存在”的账户重复问题。
 *
 * 当前阶段只有 email；phone 等标识在下一阶段接入时在此扩展，
 * 不要提前引入尚未需要的通用策略框架。
 */

/**
 * 邮箱规范化：trim + lowercase。
 *
 * 所有写入与查询 AuthIdentity.providerAccountId 的地方都必须先过这里，
 * 保证大小写与首尾空格不会绕过唯一性约束。
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 判断字符串是否为 `local@domain` 形状的邮箱（非 RFC 完整校验） */
export function isEmailIdentifier(value: string): boolean {
  const at = value.indexOf("@");
  return at > 0 && at === value.lastIndexOf("@") && at < value.length - 1;
}

/** 邮箱是否可规范化（空串或缺少 @ 视为不可用标识） */
export function isNormalizableEmail(email: string): boolean {
  return isEmailIdentifier(normalizeEmail(email));
}
