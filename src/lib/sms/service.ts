import "server-only";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { authChallengeRepository } from "@/lib/data/auth-challenge-repository";
import { createVerificationChallenge, sha256, type AuthChallengeRepository } from "@/lib/auth-challenge";
import { maskIdentifier, normalizePhone } from "@/lib/auth/identifier";
import { createAliyunSmsSender } from "./aliyun";
import type { SmsPurpose, SmsSender, SmsFailure } from "./sender";

export type SendSmsResult = { ok: true; resendAfter: number } |
  { ok: false; reason: SmsFailure; retryAfter?: number };

export async function sendVerificationSms(input: { phone: string; purpose: SmsPurpose; userId?: string; ip: string }, options: {
  sender?: SmsSender; repository?: AuthChallengeRepository; rateLimit?: typeof checkRateLimit; now?: Date;
} = {}): Promise<SendSmsResult> {
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, reason: "invalid_phone" };
  const limit = options.rateLimit ?? checkRateLimit;
  const key = sha256(phone);
  // Atomic Redis reservations happen before challenge creation / provider calls.
  // Fail closed if shared Redis is unavailable: memory fallback cannot cap SMS cost across workers.
  for (const [scope, rule] of [
    [`resend:${input.purpose}:${key}`, RateLimits.SMS_RESEND],
    [`target-day:${key}`, RateLimits.SMS_TARGET_DAY],
    [`ip:${sha256(input.ip)}`, RateLimits.SMS_SEND_IP],
  ] as const) {
    const rate = await limit(`sms:${scope}`, rule.max, rule.window, { requireRedis: true });
    if (!rate.allowed) return { ok: false, reason: rate.unavailable ? "unavailable" : "rate_limited", retryAfter: Math.max(1, Math.ceil((rate.resetTime - Date.now()) / 1000)) };
  }
  const repository = options.repository ?? authChallengeRepository;
  const start = await createVerificationChallenge({ target: phone, channel: "sms", purpose: input.purpose, userId: input.userId }, { repository, now: options.now });
  let sent = false;
  try {
    const result = await (options.sender ?? createAliyunSmsSender()).send({ phone, purpose: input.purpose, code: start.code, challengeId: start.challengeId });
    sent = result.ok;
    console.info("[sms] transport", { phone: maskIdentifier(phone), purpose: input.purpose, code: result.providerCode });
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true, resendAfter: 60 };
  } catch {
    return { ok: false, reason: "send_failed" };
  } finally {
    // Close this exact challenge, including when the SDK throws. No active orphan OTP.
    if (!sent) await repository.completeChallenge(start.challengeId, options.now ?? new Date());
  }
}
