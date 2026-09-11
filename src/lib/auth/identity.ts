/**
 * 认证身份（AuthIdentity）领域层。
 *
 * 职责分层：
 * - `User` 是 LumenLab 内部账户，Project / Conversation / Research / Paper /
 *   Learning / Artifact 等全部业务数据只关联 `User.id`。
 * - `AuthIdentity` 描述“用户可以使用什么标识找到这个账户”。Phase 2 使用
 *   email 与 phone identity（provider="local"）。
 * - 密码属于账户级凭证，`passwordHash` 仍保留在 `User`；一个用户将来无论用
 *   邮箱还是手机号作为 identifier，都共享同一个账户密码。
 *
 * Expand 阶段兼容逻辑（Contract Migration 时删除）：
 * migration 先应用、旧 Release 仍可能短暂运行的窗口内，旧版本会创建只有 legacy
 * `User.email` 而没有 AuthIdentity 的用户。因此 identity resolution 在按
 * normalized email 找不到 Identity 时，允许 fallback 到 legacy `User.email`
 * 查找历史 User，确认唯一且安全后幂等 self-heal 出缺失的 email Identity。
 * 正常情况下 AuthIdentity 始终是 Source of Truth。
 *
 * 本模块为纯领域逻辑（repository 注入），不直接依赖 Prisma。
 */

import { normalizeEmail, isNormalizableEmail, parseLoginIdentifier, type LoginIdentifier, type IdentityType } from "@/lib/auth/identifier";

export const AUTH_IDENTITY_TYPE_EMAIL = "email";
export const AUTH_IDENTITY_PROVIDER_LOCAL = "local";

/** Legacy email identity constants retained for the Expand compatibility path. */
export const EMAIL_IDENTITY = {
  type: AUTH_IDENTITY_TYPE_EMAIL,
  provider: AUTH_IDENTITY_PROVIDER_LOCAL,
} as const;

export type AuthIdentityType = IdentityType;
export type AuthIdentityProvider = typeof AUTH_IDENTITY_PROVIDER_LOCAL;

export interface AuthIdentityRow {
  id: string;
  userId: string;
  type: string;
  provider: string;
  providerAccountId: string;
  verifiedAt: Date | null;
  verificationSource: string;
}

/** 解析结果：`userId` 始终是账户主键（JWT / 业务数据只用它） */
export interface ResolvedEmailIdentity {
  identity: AuthIdentityRow;
  userId: string;
  /** 本次解析是否通过 legacy fallback 补写了缺失的 email Identity */
  selfHealed: boolean;
}

/** 解析成功时的扁平结构（避免调用方写 `resolution.identity.identity`） */
export interface ResolvedEmailResolution extends ResolvedEmailIdentity {
  kind: "resolved";
}

/**
 * legacy 兼容读取所需的 User 字段。
 *
 * `getUserByNormalizedEmail` 必须使用大小写不敏感的邮箱匹配（生产库由
 * `User_email_normalized_key` 唯一索引保证唯一性），否则 trim/大小写不同的历史
 * 邮箱会解析不到账户。
 */
export interface LegacyEmailUserRow {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  emailVerificationSource: string;
}

export interface AuthIdentityRepository {
  findEmailIdentity(
    providerAccountId: string
  ): Promise<AuthIdentityRow | null>;
  /**
   * 幂等创建 email Identity。
   * 返回 `null` 表示同一外部身份已被并发创建（或已存在），调用方应重新解析
   * 而不是当作错误。
   */
  createEmailIdentity(input: {
    userId: string;
    providerAccountId: string;
    verifiedAt: Date | null;
    verificationSource: string;
  }): Promise<AuthIdentityRow | null>;
  /**
   * 某账户当前已有的 email Identity（`[userId, type]` 唯一，故至多一条）。
   * 用于不触发 self-heal 的纯写入前校验。
   */
  findEmailIdentityByUserId(userId: string): Promise<AuthIdentityRow | null>;
  /** 大小写不敏感的 legacy User 查找（Expand 阶段兼容窗口使用） */
  getUserByNormalizedEmail(
    normalizedEmail: string
  ): Promise<LegacyEmailUserRow | null>;
}

export type EmailIdentityResolution =
  | ResolvedEmailResolution
  | { kind: "not_found" }
  /**
   * 规范化后的邮箱同时落在两个不同 User 上（理论上被唯一索引阻断）。
   * 此时必须停下来人工处理，禁止合并或覆盖账户。
   */
  | { kind: "ambiguous"; identityUserIds: string[]; legacyUserId: string };

/**
 * 按邮箱解析认证身份。
 *
 * 1. 以 AuthIdentity(type=email, provider=local, providerAccountId=normalized) 为
 *    Source of Truth。
 * 2. 找不到时 fallback 到 legacy `User.email`（大小写不敏感）。仅当 Identity 与
 *    legacy User 指向同一个账户（或其中一边缺失）时才继续；否则返回 `ambiguous`。
 * 3. 确认唯一且安全后幂等 self-heal 出缺失的 email Identity，避免后续路径反复
 *    fallback。
 */
export async function resolveEmailIdentity(
  email: string,
  repository: AuthIdentityRepository
): Promise<EmailIdentityResolution> {
  const normalized = normalizeEmail(email);
  if (!isNormalizableEmail(normalized)) return { kind: "not_found" };

  const identity = await repository.findEmailIdentity(normalized);
  const legacyUser = await repository.getUserByNormalizedEmail(normalized);

  if (identity && legacyUser && identity.userId !== legacyUser.id) {
    return {
      kind: "ambiguous",
      identityUserIds: [identity.userId],
      legacyUserId: legacyUser.id,
    };
  }

  if (identity) {
    return {
      kind: "resolved",
      identity,
      userId: identity.userId,
      selfHealed: false,
    };
  }

  if (legacyUser) {
    const healed = await repository.createEmailIdentity({
      userId: legacyUser.id,
      providerAccountId: normalized,
      verifiedAt: legacyUser.emailVerifiedAt,
      verificationSource: legacyUser.emailVerificationSource,
    });
    if (healed) {
      return {
        kind: "resolved",
        identity: healed,
        userId: healed.userId,
        selfHealed: true,
      };
    }
    // 并发请求先一步补写：重新读取既有 Identity（此时必定存在且属于同一账户）
    const existing = await repository.findEmailIdentity(normalized);
    if (!existing) return { kind: "not_found" };
    if (existing.userId !== legacyUser.id) {
      return {
        kind: "ambiguous",
        identityUserIds: [existing.userId],
        legacyUserId: legacyUser.id,
      };
    }
    return {
      kind: "resolved",
      identity: existing,
      userId: existing.userId,
      selfHealed: false,
    };
  }

  return { kind: "not_found" };
}

export type EmailIdentityAvailability =
  | { kind: "available"; /** 兼容窗口内发现的历史账户，注册时需拒绝 */ legacyUserId: string | null }
  | { kind: "taken"; userId: string; verified: boolean }
  | { kind: "conflict" };

/**
 * 写入前的邮箱占用检查（注册重复检查、验证邮件预检使用）。
 *
 * 与 `resolveEmailIdentity` 的区别：**不做 self-heal**，因此可以安全地在注册
 * 事务内调用，不会被事务自身的写入干扰；同时显式识别只有 legacy `User.email`
 * 的历史账户（migration 与 Release 切换窗口内由旧版本创建），这类账户必须继续
 * 占用该邮箱，否则会出现同一邮箱两个账户。
 */
export async function checkEmailIdentityAvailability(
  email: string,
  repository: AuthIdentityRepository
): Promise<EmailIdentityAvailability> {
  const normalized = normalizeEmail(email);
  if (!isNormalizableEmail(normalized)) return { kind: "conflict" };

  const legacyUser = await repository.getUserByNormalizedEmail(normalized);
  if (!legacyUser) {
    const identity = await repository.findEmailIdentity(normalized);
    if (!identity) return { kind: "available", legacyUserId: null };
    return {
      kind: "taken",
      userId: identity.userId,
      verified: identity.verifiedAt !== null,
    };
  }

  // 该 User 已有 identity：确认它指向的是同一个账户
  const userIdentity = await repository.findEmailIdentityByUserId(legacyUser.id);
  if (userIdentity && userIdentity.providerAccountId !== normalized) {
    return { kind: "conflict" };
  }

  const conflicting = await repository.findEmailIdentity(normalized);
  if (conflicting && conflicting.userId !== legacyUser.id) {
    return { kind: "conflict" };
  }

  return {
    kind: "taken",
    userId: legacyUser.id,
    verified: userIdentity?.verifiedAt != null || legacyUser.emailVerifiedAt !== null,
  };
}

export interface EmailVerificationState {
  verifiedAt: Date | null;
  /** 认证读取优先看 email Identity；`legacy-user` 表示走了 Expand 兼容字段 */
  source: "identity" | "legacy-user";
}

/**
 * 读取邮箱验证状态：优先 email Identity 的 verifiedAt/verificationSource，
 * 尚未 self-heal 出 Identity 时回退 legacy `User.emailVerifiedAt`。
 */
export async function resolveEmailVerificationState(
  email: string,
  repository: AuthIdentityRepository
): Promise<EmailVerificationState | null> {
  const resolution = await resolveEmailIdentity(email, repository);
  if (resolution.kind === "ambiguous") return null;
  if (resolution.kind === "resolved") {
    return { verifiedAt: resolution.identity.verifiedAt, source: "identity" };
  }
  const normalized = normalizeEmail(email);
  const legacyUser = await repository.getUserByNormalizedEmail(normalized);
  if (!legacyUser) return null;
  return { verifiedAt: legacyUser.emailVerifiedAt, source: "legacy-user" };
}

/** Generic local identities; email-only wrappers remain for the Expand window. */
export interface LocalIdentityRepository extends AuthIdentityRepository {
  findIdentity(input: Pick<LoginIdentifier, "type" | "provider" | "providerAccountId">): Promise<AuthIdentityRow | null>;
  findIdentitiesByUserId(userId: string): Promise<AuthIdentityRow[]>;
  createIdentity(input: {
    type: IdentityType; userId: string; providerAccountId: string;
    verifiedAt: Date | null; verificationSource: string;
  }): Promise<AuthIdentityRow | null>;
}

export async function resolveIdentity(value: string, repository: LocalIdentityRepository): Promise<EmailIdentityResolution> {
  const identifier = parseLoginIdentifier(value);
  if (!identifier) return { kind: "not_found" };
  if (identifier.type === "email") return resolveEmailIdentity(identifier.providerAccountId, repository);
  const identity = await repository.findIdentity(identifier);
  return identity ? { kind: "resolved", identity, userId: identity.userId, selfHealed: false } : { kind: "not_found" };
}

export async function checkIdentityAvailability(value: string, repository: LocalIdentityRepository): Promise<EmailIdentityAvailability> {
  const identifier = parseLoginIdentifier(value);
  if (!identifier) return { kind: "conflict" };
  if (identifier.type === "email") return checkEmailIdentityAvailability(identifier.providerAccountId, repository);
  const identity = await repository.findIdentity(identifier);
  return identity ? { kind: "taken", userId: identity.userId, verified: identity.verifiedAt !== null } : { kind: "available", legacyUserId: null };
}
