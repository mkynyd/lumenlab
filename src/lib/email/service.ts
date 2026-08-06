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
  createEmailChallenge,
  type ChallengeType,
} from "@/lib/auth-challenge";
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
  | { ok: false; reason: "rate_limited" | "send_failed" };

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
  kind: ChallengeType;
  challengeId: string;
  email: string;
  templateId: string;
  subject: string;
  templateData: Record<string, string>;
  rendered: Record<string, string>;
}): Promise<{ ok: true } | { ok: false; reason: "send_failed" }> {
  const log = await prisma.emailLog.create({
    data: {
      kind: input.kind,
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
    smtpMessageId: `<${input.kind}-${input.challengeId}@mail.mkynstudio.top>`,
    headers: { "X-Tencentcloudses-Cb-Kind": input.kind },
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

/** 发送注册邮箱验证邮件（双通道：验证码 + 一次性链接） */
export async function sendVerificationEmail(
  input: { email: string; ip: string },
  opts: { now?: Date } = {}
): Promise<SendEmailResult> {
  const allowed = await checkSendLimits(
    input.email,
    input.ip,
    { email: RateLimits.VERIFY_SEND_EMAIL, ip: RateLimits.VERIFY_SEND_IP },
    "verify-send"
  );
  if (!allowed) return { ok: false, reason: "rate_limited" };

  if (await isBlockedForSending(input.email)) return { ok: true };

  const start = await createEmailChallenge(
    { type: "verify", email: input.email },
    { repository: authChallengeRepository, now: opts.now }
  );
  const verifyUrl = buildVerifyUrl(start.challengeId, start.rawToken);
  const templateData = buildVerifyTemplateData(start.code, verifyUrl);
  const rendered = {
    code: start.code,
    verifyUrl,
    expiresAt: start.codeExpiresAt.toISOString(),
  };

  return deliverTemplateEmail({
    kind: "verify",
    challengeId: start.challengeId,
    email: input.email,
    templateId: getTemplateId("verify") ?? "",
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
  const allowed = await checkSendLimits(
    input.email,
    input.ip,
    { email: RateLimits.FORGOT_SEND_EMAIL, ip: RateLimits.FORGOT_SEND_IP },
    "forgot-send"
  );
  if (!allowed) return { ok: false, reason: "rate_limited" };

  if (await isBlockedForSending(input.email)) return { ok: true };

  const start = await createEmailChallenge(
    { type: "reset", email: input.email, userId: input.userId },
    { repository: authChallengeRepository, now: opts.now }
  );
  const resetUrl = buildResetUrl(start.challengeId, start.rawToken);
  const templateData = buildResetTemplateData(resetUrl);

  return deliverTemplateEmail({
    kind: "reset",
    challengeId: start.challengeId,
    email: input.email,
    templateId: getTemplateId("reset") ?? "",
    subject: buildResetSubject(),
    templateData,
    rendered: { resetUrl, expiresAt: start.tokenExpiresAt.toISOString() },
  });
}
