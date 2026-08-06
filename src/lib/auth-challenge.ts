/**
 * 邮箱验证 / 密码重设挑战领域逻辑（纯函数，repository 注入）。
 *
 * 双通道验证：6 位验证码 + 一次性链接，任一方式验证成功后签发一次性注册票据；
 * 验证成功或挑战被新挑战取代后，当前挑战立即失效。
 *
 * 安全约定（与 approval-token 一致）：明文 code / raw token / ticket 只在签发
 * 时存在于内存与返回给调用方；数据库只存 sha256。
 */

import crypto from "crypto";

export const CODE_TTL_MS = 15 * 60 * 1000; // 验证码有效期 15 分钟
export const TOKEN_TTL_MS = 60 * 60 * 1000; // 链接 token 有效期 60 分钟
export const TICKET_TTL_MS = 15 * 60 * 1000; // 注册票据有效期 15 分钟
export const MAX_CODE_ATTEMPTS = 5; // 验证码最多失败 5 次

export type ChallengeType = "verify" | "reset";

// type 字段保持 string：Prisma 生成类型为 string，领域层不依赖其字面量值
export interface EmailChallengeRow {
  id: string;
  email: string;
  type: string;
  userId: string | null;
  codeHash: string;
  codeExpiresAt: Date;
  codeAttempts: number;
  verifiedAt: Date | null;
  consumedAt: Date | null;
}

export interface EmailChallengeTokenRow {
  email: string;
  type: string;
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
  verifiedAt: Date | null;
  verifiedVia: string | null;
  ticketHash: string | null;
  ticketExpiresAt: Date | null;
  ticketConsumedAt: Date | null;
  consumedAt: Date | null;
}

export interface AuthChallengeRepository {
  /** 将同 email+type 的旧活跃挑战置 consumedAt（发新挑战前调用） */
  invalidateActiveChallenges(
    email: string,
    type: ChallengeType,
    now: Date
  ): Promise<void>;
  createChallenge(input: {
    type: ChallengeType;
    email: string;
    userId?: string;
    codeHash: string;
    codeExpiresAt: Date;
    tokenHash: string;
    tokenExpiresAt: Date;
  }): Promise<{ id: string }>;
  findActiveByEmail(
    email: string,
    type: ChallengeType
  ): Promise<EmailChallengeRow | null>;
  /** 原子：仅当未关闭/未验证且未达上限时 attempts+1；超限自动关闭挑战 */
  incrementCodeAttempt(id: string, maxAttempts: number, now: Date): Promise<boolean>;
  /** 原子：验证码匹配后 claim，同时签发票据 */
  markCodeVerified(input: {
    id: string;
    ticketHash: string;
    ticketExpiresAt: Date;
    now: Date;
  }): Promise<boolean>;
  findToken(challengeId: string): Promise<EmailChallengeTokenRow | null>;
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
  rawToken: string; // 明文链接 token，仅此函数返回
  codeExpiresAt: Date;
  tokenExpiresAt: Date;
}

/**
 * 创建新挑战（先关闭同 email+type 的旧活跃挑战，再落库 hash）。
 * 返回的明文 code / rawToken 仅用于构造邮件内容。
 */
export async function createEmailChallenge(
  input: { type: ChallengeType; email: string; userId?: string },
  opts: {
    repository: AuthChallengeRepository;
    codeTtlMs?: number;
    tokenTtlMs?: number;
    now?: Date;
  }
): Promise<ChallengeStart> {
  const now = opts.now || new Date();
  const codeTtlMs = opts.codeTtlMs ?? CODE_TTL_MS;
  const tokenTtlMs = opts.tokenTtlMs ?? TOKEN_TTL_MS;

  const code = generateCode();
  const rawToken = generateRaw();
  const codeExpiresAt = new Date(now.getTime() + codeTtlMs);
  const tokenExpiresAt = new Date(now.getTime() + tokenTtlMs);

  await opts.repository.invalidateActiveChallenges(input.email, input.type, now);
  const { id } = await opts.repository.createChallenge({
    type: input.type,
    email: input.email,
    userId: input.userId,
    codeHash: sha256(code),
    codeExpiresAt,
    tokenHash: sha256(rawToken),
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

/** 验证码通道验证。成功后签发一次性注册票据。 */
export async function verifyWithCode(
  input: { type: ChallengeType; email: string; code: string },
  opts: {
    repository: AuthChallengeRepository;
    maxAttempts?: number;
    now?: Date;
  }
): Promise<CodeVerifyResult> {
  const now = opts.now || new Date();
  const maxAttempts = opts.maxAttempts ?? MAX_CODE_ATTEMPTS;

  const challenge = await opts.repository.findActiveByEmail(
    input.email,
    input.type
  );
  if (!challenge) return { ok: false, reason: "no_challenge" };
  if (challenge.verifiedAt) return { ok: false, reason: "already_verified" };
  if (challenge.codeExpiresAt.getTime() < now.getTime()) {
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

/** 链接通道验证（`<challengeId>.<raw>`）。消费链接并签发一次性注册票据。 */
export async function verifyWithLink(
  input: { token: string },
  opts: { repository: AuthChallengeRepository; now?: Date }
): Promise<LinkVerifyResult> {
  const now = opts.now || new Date();
  const split = splitRawToken(input.token);
  if (!split) return { ok: false, reason: "malformed" };

  const challenge = await opts.repository.findToken(split.id);
  if (!challenge || challenge.tokenHash !== sha256(split.raw)) {
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

  return { ok: true, email: challenge.email, ticket: `${split.id}.${rawTicket}` };
}
