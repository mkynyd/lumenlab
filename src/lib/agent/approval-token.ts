/**
 * 一次性审批 token
 *
 * 发出的 token 形如 `<tokenId>.<raw>`，raw 部分在数据库只存 sha256。
 * 用户批准后服务端在执行前再次校验 token 哈希和参数哈希，
 * 防止模型在等待审批期间把参数从 A 替换为 B。
 */

import crypto from "crypto";
import { prisma } from "@/lib/db";

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 分钟

function sha256(input: string | Buffer): string {
  return crypto
    .createHash("sha256")
    .update(typeof input === "string" ? Buffer.from(input, "utf8") : input)
    .digest("hex");
}

/**
 * 规范化 JSON：按 key 排序，避免不同 key 顺序产生不同哈希
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export function hashArguments(args: Record<string, unknown>): string {
  return sha256(canonicalJson(args));
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
  tokenId: string;
}

export async function issueApprovalToken(params: {
  userId: string;
  conversationId: string;
  toolId: string;
  argumentsHash: string;
  requestId: string;
}): Promise<IssuedToken> {
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  const raw = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sha256(raw);
  const record = await prisma.approvalToken.create({
    data: {
      tokenHash,
      userId: params.userId,
      conversationId: params.conversationId,
      toolId: params.toolId,
      argumentsHash: params.argumentsHash,
      requestId: params.requestId,
      expiresAt,
    },
  });
  return {
    token: `${record.id}.${raw}`,
    expiresAt,
    tokenId: record.id,
  };
}

export type ConsumeResult =
  | {
      ok: true;
      recordId: string;
      userId: string;
      conversationId: string;
      toolId: string;
      requestId: string;
    }
  | {
      ok: false;
      reason:
        | "MALFORMED"
        | "NOT_FOUND"
        | "ALREADY_CONSUMED"
        | "EXPIRED"
        | "ARGUMENTS_CHANGED"
        | "BINDING_MISMATCH";
    };

export interface ApprovalTokenBinding {
  userId: string;
  conversationId: string;
  toolId: string;
  requestId: string;
}

export async function consumeApprovalToken(
  token: string,
  presentedArguments: Record<string, unknown>,
  expectedBinding?: ApprovalTokenBinding
): Promise<ConsumeResult> {
  const dot = token.indexOf(".");
  if (dot < 0) return { ok: false, reason: "MALFORMED" };
  const raw = token.slice(dot + 1);
  const tokenId = token.slice(0, dot);
  if (!raw || !tokenId) return { ok: false, reason: "MALFORMED" };
  const tokenHash = sha256(raw);
  const record = await prisma.approvalToken.findUnique({
    where: { tokenHash },
  });
  if (!record || record.id !== tokenId) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (record.consumedAt) return { ok: false, reason: "ALREADY_CONSUMED" };
  if (record.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "EXPIRED" };
  }
  const presentedHash = hashArguments(presentedArguments);
  if (presentedHash !== record.argumentsHash) {
    return { ok: false, reason: "ARGUMENTS_CHANGED" };
  }
  if (
    expectedBinding &&
    (record.userId !== expectedBinding.userId ||
      record.conversationId !== expectedBinding.conversationId ||
      record.toolId !== expectedBinding.toolId ||
      record.requestId !== expectedBinding.requestId)
  ) {
    return { ok: false, reason: "BINDING_MISMATCH" };
  }
  const claimed = await prisma.approvalToken.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) {
    return { ok: false, reason: "ALREADY_CONSUMED" };
  }
  return {
    ok: true,
    recordId: record.id,
    userId: record.userId,
    conversationId: record.conversationId,
    toolId: record.toolId,
    requestId: record.requestId,
  };
}
