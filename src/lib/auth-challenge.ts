/**
 * 验证挑战（VerificationChallenge）领域逻辑（纯函数，repository 注入）。
 *
 * 目标模型可表达 `channel = email | sms`、`target = 邮箱或手机号`、
 * `purpose = register | bind_identity | password_reset | ...`，并复用验证码 Hash、
 * TTL、attempt、一次性消费、Ticket 等安全机制。Phase 2 同时支持 email 与 SMS；
 * SMS 只使用验证码，不发链接 token。
 *
 * 双通道验证：6 位验证码 + 一次性链接，任一方式验证成功后签发一次性票据；
 * 验证成功或挑战被新挑战取代后，当前挑战立即失效。
 *
 * 安全约定（与 approval-token 一致）：明文 code / raw token / ticket 只在签发
 * 时存在于内存与返回给调用方；数据库只存 sha256。
 *
 * Expand 兼容（Contract Migration 时删除）：物理表仍为 `EmailChallenge`，旧 Release
 * 只写 legacy 的 `type` / `email`，新增的 `channel` / `target` / `purpose` 为
 * nullable。读取 pending challenge 时统一通过 `resolveChallengeChannel` /
 * `resolveChallengePurpose` 从 legacy 列无损推导，不假设通用列一定有值。
 */

import crypto from "crypto";
import { normalizeEmail, parseLoginIdentifier } from "@/lib/auth/identifier";

export const CODE_TTL_MS = 15 * 60 * 1000; // 验证码有效期 15 分钟
export const SMS_CODE_TTL_MS = 5 * 60 * 1000;
export const TOKEN_TTL_MS = 60 * 60 * 1000; // 链接 token 有效期 60 分钟
export const TICKET_TTL_MS = 15 * 60 * 1000; // 注册票据有效期 15 分钟
export const MAX_CODE_ATTEMPTS = 5; // 验证码最多失败 5 次

// ---------------------------------------------------------------------------
// 通用语义（channel / target / purpose）
// ---------------------------------------------------------------------------

export type VerificationChannel = "email" | "sms";

/**
 * 挑战用途。当前仓库真实使用的 legacy `type` 只有 "verify"（注册邮箱验证）与
 * "reset"（密码重设），映射关系见 `PURPOSE_BY_LEGACY_TYPE`，不要凭猜测扩展。
 */
export type VerificationPurpose =
  | "register"
  | "bind_identity"
  | "password_reset";

export const PURPOSE_BY_LEGACY_TYPE: Record<string, VerificationPurpose> = {
  verify: "register",
  reset: "password_reset",
  bind_identity: "bind_identity",
};

/** 写入 legacy `type` 列时使用的反向映射（与上面一一对应） */
export const LEGACY_TYPE_BY_PURPOSE: Record<VerificationPurpose, string> = {
  register: "verify",
  password_reset: "reset",
  bind_identity: "bind_identity",
};

const EMAIL_CHANNEL: VerificationChannel = "email";

/** 通用列缺失时按历史 email channel 读取。 */
export function resolveChallengeChannel(row: {
  channel?: string | null;
}): VerificationChannel {
  return (row.channel as VerificationChannel | null) ?? EMAIL_CHANNEL;
}

/** 通用列缺失时从 legacy `type` 推导 purpose */
export function resolveChallengePurpose(row: {
  purpose?: string | null;
  type?: string | null;
}): VerificationPurpose {
  if (row.purpose) return row.purpose as VerificationPurpose;
  return PURPOSE_BY_LEGACY_TYPE[row.type ?? ""] ?? "register";
}

/** 通用列缺失时从 legacy `email` 推导并规范化 target */
export function resolveChallengeTarget(row: {
  target?: string | null;
  email?: string | null;
}): string {
  if (row.target) return row.target;
  return normalizeEmail(row.email ?? "");
}

/** email channel 的通用字段三元组（新版本写入时与 legacy 列双写） */
export function emailChallengeGenericFields(input: {
  email: string;
  purpose: VerificationPurpose;
}): { channel: VerificationChannel; target: string; purpose: VerificationPurpose } {
  return {
    channel: EMAIL_CHANNEL,
    target: normalizeEmail(input.email),
    purpose: input.purpose,
  };
}

// ---------------------------------------------------------------------------
// Repository 契约
// ---------------------------------------------------------------------------

export interface ChallengeRow {
  id: string;
  email: string;
  type: string;
  channel: string | null;
  target: string | null;
  purpose: string | null;
  userId: string | null;
  codeHash: string;
  codeExpiresAt: Date;
  codeAttempts: number;
  verifiedAt: Date | null;
  consumedAt: Date | null;
}

export interface ChallengeTokenRow {
  email: string;
  type: string;
  channel: string | null;
  target: string | null;
  purpose: string | null;
  tokenHash: string | null;
  tokenExpiresAt: Date | null;
  tokenConsumedAt: Date | null;
  verifiedAt: Date | null;
  consumedAt: Date | null;
}

export interface ChallengeForTicketRow {
  id: string;
  email: string;
  type: string;
  channel: string | null;
  target: string | null;
  purpose: string | null;
  verifiedAt: Date | null;
  verifiedVia: string | null;
  ticketHash: string | null;
  ticketExpiresAt: Date | null;
  ticketConsumedAt: Date | null;
  consumedAt: Date | null;
}

export type ChallengeScope = { channel: VerificationChannel; userId?: string };

export interface AuthChallengeRepository {
  /** 将同 target+purpose 的旧活跃挑战置 consumedAt（发新挑战前调用） */
  invalidateActiveChallenges(
    email: string,
    purpose: VerificationPurpose,
    now: Date,
    scope?: ChallengeScope
  ): Promise<void>;
  /**
   * 创建挑战：通用字段与 legacy `type`/`email` 同时写入，
   * 保证 migration 窗口内两个版本都能读到。
   */
  createChallenge(input: {
    purpose: VerificationPurpose;
    channel?: VerificationChannel;
    email: string;
    userId?: string;
    codeHash: string;
    codeExpiresAt: Date;
    tokenHash: string | null;
    tokenExpiresAt: Date | null;
  }): Promise<{ id: string }>;
  findActiveByEmail(
    email: string,
    purpose: VerificationPurpose,
    scope?: ChallengeScope
  ): Promise<ChallengeRow | null>;
  /** 原子：仅当未关闭/未验证且未达上限时 attempts+1；超限自动关闭挑战 */
  incrementCodeAttempt(id: string, maxAttempts: number, now: Date): Promise<boolean>;
  /** 原子：验证码匹配后 claim，同时签发票据 */
  markCodeVerified(input: {
    id: string;
    ticketHash: string;
    ticketExpiresAt: Date;
    now: Date;
  }): Promise<boolean>;
  findToken(challengeId: string): Promise<ChallengeTokenRow | null>;
  /** 原子：链接 claim，同时签发票据 */
  markTokenVerified(input: {
    id: string;
    tokenHash: string;
    ticketHash: string;
    ticketExpiresAt: Date;
    now: Date;
  }): Promise<boolean>;
  findChallengeForTicket(
    challengeId: string
  ): Promise<ChallengeForTicketRow | null>;
  /** 原子：票据 claim —— 仅当 id + ticketHash 匹配 + 未消费 + 未过期 + 挑战未关闭 */
  consumeTicket(input: {
    challengeId: string;
    ticketHash: string;
    now: Date;
  }): Promise<boolean>;
  completeChallenge(challengeId: string, now: Date): Promise<void>;
}

export function sha256(input: string): string {
  return crypto
    .createHash("sha256")
    .update(Buffer.from(input, "utf8"))
    .digest("hex");
}

/** 拆分 `<id>.<raw>` 格式的 token / ticket */
export function splitRawToken(token: string): {
  id: string;
  raw: string;
} | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const id = token.slice(0, dot);
  const raw = token.slice(dot + 1);
  if (!id || !raw) return null;
  return { id, raw };
}

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function generateRaw(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export interface ChallengeStart {
  challengeId: string;
  code: string; // 明文验证码，仅此函数返回（下游只有邮件层）
  rawToken: string | null; // 明文链接 token，仅此函数返回
  codeExpiresAt: Date;
  tokenExpiresAt: Date | null;
}

/**
 * 创建新挑战（先关闭同 target+purpose 的旧活跃挑战，再落库 hash）。
 * 返回的明文 code / rawToken 仅用于构造邮件内容。
 *
 * email 与 SMS 共用这一 challenge 生命周期；SMS 按 channel 使用较短 TTL 且不创建链接 token。
 */
export async function createVerificationChallenge(
  input: {
    purpose: VerificationPurpose;
    target: string;
    channel?: VerificationChannel;
    userId?: string;
  },
  opts: {
    repository: AuthChallengeRepository;
    codeTtlMs?: number;
    tokenTtlMs?: number;
    now?: Date;
  }
): Promise<ChallengeStart> {
  const now = opts.now || new Date();
  const identifier = parseLoginIdentifier(input.target);
  const channel = input.channel ?? "email";
  if (!identifier || identifier.channel !== channel ||
      (input.purpose === "bind_identity" && !input.userId) ||
      (input.purpose === "register" && input.userId) ||
      (channel === "sms" && input.purpose === "password_reset")) {
    throw new Error("Invalid verification challenge scope");
  }
  const target = identifier.providerAccountId;
  const scope = { channel, userId: input.userId };
  const codeTtlMs = channel === "sms" ? SMS_CODE_TTL_MS : (opts.codeTtlMs ?? CODE_TTL_MS);
  const tokenTtlMs = opts.tokenTtlMs ?? TOKEN_TTL_MS;

  const code = generateCode();
  const rawToken = channel === "email" && input.purpose !== "bind_identity" ? generateRaw() : null;
  const codeExpiresAt = new Date(now.getTime() + codeTtlMs);
  const tokenExpiresAt = rawToken ? new Date(now.getTime() + tokenTtlMs) : null;

  await opts.repository.invalidateActiveChallenges(target, input.purpose, now, scope);
  const { id } = await opts.repository.createChallenge({
    purpose: input.purpose,
    email: target,
    channel,
    userId: input.userId,
    codeHash: sha256(code),
    codeExpiresAt,
    tokenHash: rawToken ? sha256(rawToken) : null,
    tokenExpiresAt,
  });

  return {
    challengeId: id,
    code,
    rawToken,
    codeExpiresAt,
    tokenExpiresAt,
  };
}

/** 便捷入口：注册邮箱验证挑战（purpose="register"，email channel） */
export function createEmailChallenge(
  input: { email: string; userId?: string },
  opts: Parameters<typeof createVerificationChallenge>[1]
): Promise<ChallengeStart> {
  return createVerificationChallenge(
    { purpose: "register", target: input.email, userId: input.userId },
    opts
  );
}

export type CodeVerifyResult =
  | { ok: true; ticket: string }
  | {
      ok: false;
      reason:
        | "no_challenge"
        | "already_verified"
        | "expired"
        | "invalid_code"
        | "attempts_exceeded";
    };

/** 验证码通道验证。成功后签发一次性票据。 */
export async function verifyWithCode(
  input: { purpose: VerificationPurpose; email?: string; target?: string; channel?: VerificationChannel; userId?: string; code: string },
  opts: {
    repository: AuthChallengeRepository;
    maxAttempts?: number;
    now?: Date;
  }
): Promise<CodeVerifyResult> {
  const now = opts.now || new Date();
  const maxAttempts = opts.maxAttempts ?? MAX_CODE_ATTEMPTS;

  const identifier = parseLoginIdentifier(input.target ?? input.email);
  const channel = input.channel ?? "email";
  if (!identifier || identifier.channel !== channel ||
      (input.purpose === "bind_identity" && !input.userId) ||
      (input.purpose === "register" && input.userId) ||
      (channel === "sms" && input.purpose === "password_reset")) return { ok: false, reason: "no_challenge" };
  const challenge = await opts.repository.findActiveByEmail(
    identifier.providerAccountId, input.purpose, { channel, userId: input.userId }
  );
  if (!challenge || challenge.consumedAt ||
      resolveChallengeChannel(challenge) !== channel ||
      resolveChallengePurpose(challenge) !== input.purpose ||
      resolveChallengeTarget(challenge) !== identifier.providerAccountId ||
      (challenge.userId ?? null) !== (input.userId ?? null)) return { ok: false, reason: "no_challenge" };
  if (challenge.codeAttempts >= maxAttempts) return { ok: false, reason: "attempts_exceeded" };
  if (challenge.verifiedAt) return { ok: false, reason: "already_verified" };
  if (challenge.codeExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  if (sha256(input.code) !== challenge.codeHash) {
    const incremented = await opts.repository.incrementCodeAttempt(
      challenge.id,
      maxAttempts,
      now
    );
    if (!incremented) return { ok: false, reason: "attempts_exceeded" };
    return { ok: false, reason: "invalid_code" };
  }

  const rawTicket = generateRaw();
  const ticketHash = sha256(rawTicket);
  const ticketExpiresAt = new Date(now.getTime() + TICKET_TTL_MS);
  const claimed = await opts.repository.markCodeVerified({
    id: challenge.id,
    ticketHash,
    ticketExpiresAt,
    now,
  });
  if (!claimed) return { ok: false, reason: "already_verified" };

  return { ok: true, ticket: `${challenge.id}.${rawTicket}` };
}

export type LinkVerifyResult =
  | { ok: true; email: string; ticket: string }
  | { ok: false; reason: "malformed" | "not_found" | "already_used" | "expired" };

/**
 * 链接通道验证（`<challengeId>.<raw>`）。消费链接并签发一次性票据。
 * 返回的 `email`/`target` 为挑战的投递目标（当前阶段即邮箱）。
 */
export async function verifyWithLink(
  input: { token: string },
  opts: { repository: AuthChallengeRepository; now?: Date }
): Promise<LinkVerifyResult> {
  const now = opts.now || new Date();
  const split = splitRawToken(input.token);
  if (!split) return { ok: false, reason: "malformed" };

  const challenge = await opts.repository.findToken(split.id);
  if (!challenge || challenge.consumedAt ||
      resolveChallengeChannel(challenge) !== "email" ||
      resolveChallengePurpose(challenge) !== "register" ||
      challenge.tokenHash !== sha256(split.raw)) {
    return { ok: false, reason: "not_found" };
  }
  if (challenge.verifiedAt) return { ok: false, reason: "already_used" };
  if (challenge.tokenConsumedAt) return { ok: false, reason: "already_used" };
  if (!challenge.tokenExpiresAt || challenge.tokenExpiresAt.getTime() < now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  const rawTicket = generateRaw();
  const ticketHash = sha256(rawTicket);
  const ticketExpiresAt = new Date(now.getTime() + TICKET_TTL_MS);
  const claimed = await opts.repository.markTokenVerified({
    id: split.id,
    tokenHash: sha256(split.raw),
    ticketHash,
    ticketExpiresAt,
    now,
  });
  if (!claimed) return { ok: false, reason: "already_used" };

  // Expand 兼容：旧 Release 写入的挑战只有 legacy email 列，
  // 这里用 resolveChallengeTarget 无损推导通用 target。
  const target = resolveChallengeTarget(challenge);
  return { ok: true, email: target, ticket: `${split.id}.${rawTicket}` };
}
