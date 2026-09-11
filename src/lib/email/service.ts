/**
 * 认证邮件发送编排：限流 → 创建挑战 → 渲染 → 发送 → 写 EmailLog。
 *
 * - 邮箱维度限流（3 封/10 分钟）+ IP 维度限流（5 次/10 分钟）
 * - 被投递失败/投诉标记的地址（dropped / hard bounce / spamreport）静默跳过，
 *   对用户仍返回成功（防枚举）
 * - 未配置 SES 或模板时由 ses-client 降级 dry-run，EmailLog 照常记录
 */

import "server-only";
import { prisma } from "@/lib/db";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import {
  createVerificationChallenge,
  type VerificationPurpose,
} from "@/lib/auth-challenge";
import { normalizeEmail } from "@/lib/auth/identifier";
import { authChallengeRepository } from "@/lib/data/auth-challenge-repository";
import { sendTemplateEmail } from "@/lib/email/ses-client";
import {
  buildResetSubject,
  buildResetTemplateData,
  buildResetUrl,
  buildVerifySubject,
  buildVerifyTemplateData,
  buildVerifyUrl,
  getTemplateId,
} from "@/lib/email/templates";

export type SendEmailResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" | "send_failed" | "unavailable" };

/**
 * EmailLog.kind / SES 回调头沿用 legacy 取值（verify / reset）。
 * 领域层已改用通用 purpose，这里做一次显式映射，本阶段不改 EmailLog 表结构。
 */
const LEGACY_EMAIL_KIND: Record<VerificationPurpose, string> = {
  register: "verify",
  password_reset: "reset",
  bind_identity: "verify",
};

/** dropped / hard bounce / spamreport 后停止向该地址发送认证邮件 */
export async function isBlockedForSending(email: string): Promise<boolean> {
  const latest = await prisma.emailLog.findFirst({
    where: {
      email,
      OR: [
        { event: "dropped" },
        { event: "spamreport" },
        { event: "bounced", bounceType: "hard_bounce" },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return latest !== null;
}

async function checkSendLimits(
  email: string,
  ip: string,
  limits: { email: typeof RateLimits.VERIFY_SEND_EMAIL; ip: typeof RateLimits.VERIFY_SEND_IP },
  keyPrefix: string
): Promise<boolean> {
  const byEmail = await checkRateLimit(
    `${keyPrefix}:email:${email}`,
    limits.email.max,
    limits.email.window
  );
  if (!byEmail.allowed) return false;
  const byIp = await checkRateLimit(
    `${keyPrefix}:ip:${ip}`,
    limits.ip.max,
    limits.ip.window
  );
  return byIp.allowed;
}

async function deliverTemplateEmail(input: {
  kind: VerificationPurpose;
  challengeId: string;
  email: string;
  templateId: string;
  subject: string;
  templateData: Record<string, string>;
  rendered: Record<string, string>;
}): Promise<{ ok: true } | { ok: false; reason: "send_failed" }> {
  const log = await prisma.emailLog.create({
    data: {
      // EmailLog.kind 沿用 legacy 取值（verify/reset），本阶段不改表
      kind: LEGACY_EMAIL_KIND[input.kind],
      email: input.email,
      challengeId: input.challengeId,
      templateId: input.templateId,
      event: "sending",
    },
    select: { id: true },
  });

  const result = await sendTemplateEmail({
    to: input.email,
    subject: input.subject,
    templateId: input.templateId,
    templateData: input.templateData,
    smtpMessageId: `<${LEGACY_EMAIL_KIND[input.kind]}-${input.challengeId}@mail.mkynstudio.top>`,
    headers: { "X-Tencentcloudses-Cb-Kind": LEGACY_EMAIL_KIND[input.kind] },
  });

  if (!result.ok) {
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { event: "failed", payload: { error: result.error } },
    });
    return { ok: false, reason: "send_failed" };
  }

  await prisma.emailLog.update({
    where: { id: log.id },
    data: {
      event: "sent",
      bulkId: result.bulkId,
      payload: result.dryRun
        ? { dryRun: true, rendered: input.rendered }
        : { rendered: input.rendered },
    },
  });
  return { ok: true };
}

/**
 * 发送注册邮箱验证邮件（双通道：验证码 + 一次性链接）。
 *
 * 领域层已泛化为 VerificationChallenge（purpose="register"，
 * channel 由当前唯一的 email 通道决定）；邮件层是 email channel 的实现。
 */
export async function sendVerificationEmail(
  input: { email: string; ip: string; purpose?: "register" | "bind_identity"; userId?: string },
  opts: { now?: Date } = {}
): Promise<SendEmailResult> {
  const email = normalizeEmail(input.email);
  if (input.purpose === "bind_identity" && !getTemplateId("bind_identity")) return { ok: false, reason: "unavailable" };
  const allowed = await checkSendLimits(
    email,
    input.ip,
    { email: RateLimits.VERIFY_SEND_EMAIL, ip: RateLimits.VERIFY_SEND_IP },
    "verify-send"
  );
  if (!allowed) return { ok: false, reason: "rate_limited" };

  if (await isBlockedForSending(email)) return { ok: true };

  const start = await createVerificationChallenge(
    { purpose: input.purpose ?? "register", target: email, userId: input.userId },
    { repository: authChallengeRepository, now: opts.now }
  );
  // 模板链接域名固定为生产域名，变量只承载 token
  const verifyToken = start.rawToken ? `${start.challengeId}.${start.rawToken}` : "";
  const templateData = input.purpose === "bind_identity" ? { code: start.code } : buildVerifyTemplateData(start.code, verifyToken);
  const rendered = {
    code: start.code,
    verifyToken,
    verifyUrl: start.rawToken ? buildVerifyUrl(start.challengeId, start.rawToken) : "",
    expiresAt: start.codeExpiresAt.toISOString(),
  };

  return deliverTemplateEmail({
    kind: input.purpose ?? "register",
    challengeId: start.challengeId,
    email,
    templateId: getTemplateId(input.purpose === "bind_identity" ? "bind_identity" : "verify") ?? "",
    subject: buildVerifySubject(),
    templateData,
    rendered,
  });
}

/** 发送密码重设邮件（一次性链接，token 60 分钟有效） */
export async function sendPasswordResetEmail(
  input: { email: string; userId: string; ip: string },
  opts: { now?: Date } = {}
): Promise<SendEmailResult> {
  const email = normalizeEmail(input.email);
  const allowed = await checkSendLimits(
    email,
    input.ip,
    { email: RateLimits.FORGOT_SEND_EMAIL, ip: RateLimits.FORGOT_SEND_IP },
    "forgot-send"
  );
  if (!allowed) return { ok: false, reason: "rate_limited" };

  if (await isBlockedForSending(email)) return { ok: true };

  const start = await createVerificationChallenge(
    { purpose: "password_reset", target: email, userId: input.userId },
    { repository: authChallengeRepository, now: opts.now }
  );
  const resetToken = `${start.challengeId}.${start.rawToken}`;
  const templateData = buildResetTemplateData(resetToken);

  return deliverTemplateEmail({
    kind: "password_reset",
    challengeId: start.challengeId,
    email,
    templateId: getTemplateId("reset") ?? "",
    subject: buildResetSubject(),
    templateData,
    rendered: {
      resetToken,
      resetUrl: buildResetUrl(start.challengeId, start.rawToken!),
      expiresAt: start.tokenExpiresAt!.toISOString(),
    },
  });
}
