import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  emailLog,
  checkRateLimit,
  authChallengeRepository,
  sendTemplateEmail,
} = vi.hoisted(() => ({
  emailLog: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
  },
  checkRateLimit: vi.fn(),
  authChallengeRepository: {
    invalidateActiveChallenges: vi.fn(),
    createChallenge: vi.fn(),
    findActiveByEmail: vi.fn(),
    incrementCodeAttempt: vi.fn(),
    markCodeVerified: vi.fn(),
    findToken: vi.fn(),
    markTokenVerified: vi.fn(),
    findChallengeForTicket: vi.fn(),
    consumeTicket: vi.fn(),
    completeChallenge: vi.fn(),
  },
  sendTemplateEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { emailLog } }));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit,
  RateLimits: {
    VERIFY_SEND_EMAIL: { max: 3, window: 600_000 },
    VERIFY_SEND_IP: { max: 5, window: 600_000 },
    FORGOT_SEND_EMAIL: { max: 3, window: 600_000 },
    FORGOT_SEND_IP: { max: 5, window: 600_000 },
  },
}));

vi.mock("@/lib/data/auth-challenge-repository", () => ({
  authChallengeRepository,
}));

vi.mock("@/lib/email/ses-client", () => ({ sendTemplateEmail }));

import { isBlockedForSending, sendVerificationEmail } from "@/lib/email/service";
import { verifyWithCode } from "@/lib/auth-challenge";

const NOW = new Date("2026-08-06T12:00:00.000Z");

describe("sendVerificationEmail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    emailLog.create.mockReset().mockResolvedValue({ id: "log-1" });
    emailLog.update.mockReset().mockResolvedValue({});
    emailLog.findFirst.mockReset().mockResolvedValue(null);
    checkRateLimit.mockReset().mockResolvedValue({ allowed: true });
    authChallengeRepository.invalidateActiveChallenges
      .mockReset()
      .mockResolvedValue(undefined);
    authChallengeRepository.createChallenge
      .mockReset()
      .mockResolvedValue({ id: "challenge-1" });
    sendTemplateEmail.mockReset().mockResolvedValue({
      ok: true,
      bulkId: "qcloud-ses-messageid",
      dryRun: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a challenge, sends the email, and records the EmailLog lifecycle", async () => {
    const result = await sendVerificationEmail({
      email: "new@example.com",
      ip: "1.2.3.4",
    });

    expect(result).toEqual({ ok: true });
    expect(checkRateLimit).toHaveBeenCalledWith(
      "verify-send:email:new@example.com",
      3,
      600_000
    );
    expect(checkRateLimit).toHaveBeenCalledWith("verify-send:ip:1.2.3.4", 5, 600_000);
    expect(authChallengeRepository.createChallenge).toHaveBeenCalled();
    expect(emailLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "verify",
        email: "new@example.com",
        challengeId: "challenge-1",
        event: "sending",
      }),
      select: { id: true },
    });
    expect(sendTemplateEmail).toHaveBeenCalledWith({
      to: "new@example.com",
      subject: "LumenLab 邮箱验证",
      templateId: "",
      templateData: {
        code: expect.stringMatching(/^\d{6}$/),
        // 模板链接域名固定，变量只承载 token（<challengeId>.<raw>）
        verifyToken: expect.stringMatching(/^challenge-1\.[A-Za-z0-9_-]+$/),
      },
      smtpMessageId: "<verify-challenge-1@mail.mkynstudio.top>",
      headers: { "X-Tencentcloudses-Cb-Kind": "verify" },
    });
    expect(emailLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: {
        event: "sent",
        bulkId: "qcloud-ses-messageid",
        payload: expect.any(Object),
      },
    });
  });

  it("rejects with rate_limited when the email-level limit is hit", async () => {
    checkRateLimit.mockImplementation((key: string) =>
      Promise.resolve(
        key.startsWith("verify-send:email:")
          ? { allowed: false }
          : { allowed: true }
      )
    );

    const result = await sendVerificationEmail({
      email: "new@example.com",
      ip: "1.2.3.4",
    });

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(authChallengeRepository.createChallenge).not.toHaveBeenCalled();
    expect(sendTemplateEmail).not.toHaveBeenCalled();
  });

  it("silently skips sending for blocked addresses but reports success", async () => {
    emailLog.findFirst.mockResolvedValue({ id: "old-bounce" });

    const result = await sendVerificationEmail({
      email: "bounced@example.com",
      ip: "1.2.3.4",
    });

    expect(result).toEqual({ ok: true });
    expect(authChallengeRepository.createChallenge).not.toHaveBeenCalled();
    expect(sendTemplateEmail).not.toHaveBeenCalled();
    expect(emailLog.create).not.toHaveBeenCalled();
  });

  it("marks the EmailLog as failed when the send fails", async () => {
    sendTemplateEmail.mockResolvedValue({ ok: false, error: "quota exceeded" });

    const result = await sendVerificationEmail({
      email: "new@example.com",
      ip: "1.2.3.4",
    });

    expect(result).toEqual({ ok: false, reason: "send_failed" });
    expect(emailLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { event: "failed", payload: { error: "quota exceeded" } },
    });
  });
});

describe("isBlockedForSending", () => {
  beforeEach(() => {
    emailLog.findFirst.mockReset();
  });

  it("queries for hard bounce, drop, or spam report rows", async () => {
    emailLog.findFirst.mockResolvedValue({ id: "row-1" });

    expect(await isBlockedForSending("bad@example.com")).toBe(true);
    expect(emailLog.findFirst).toHaveBeenCalledWith({
      where: {
        email: "bad@example.com",
        OR: [
          { event: "dropped" },
          { event: "spamreport" },
          { event: "bounced", bounceType: "hard_bounce" },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
  });

  it("allows delivery when no blocking row exists (soft bounce / delivered / fresh)", async () => {
    emailLog.findFirst.mockResolvedValue(null);
    expect(await isBlockedForSending("ok@example.com")).toBe(false);
  });

  it("the verified challenge from the sent email can be consumed by verifyWithCode", async () => {
    // 与 auth-challenge 领域逻辑的集成点：service 创建的挑战可通过 code 验证
    emailLog.findFirst.mockResolvedValue(null);
    checkRateLimit.mockResolvedValue({ allowed: true });
    authChallengeRepository.createChallenge.mockResolvedValue({ id: "challenge-1" });
    authChallengeRepository.findActiveByEmail.mockResolvedValue({
      id: "challenge-1",
      email: "new@example.com",
      type: "verify",
      userId: null,
      codeHash: "",
      codeExpiresAt: new Date(NOW.getTime() + 15 * 60 * 1000),
      codeAttempts: 0,
      verifiedAt: null,
      consumedAt: null,
    });
    authChallengeRepository.markCodeVerified.mockResolvedValue(true);

    const { sha256 } = await import("@/lib/auth-challenge");
    await sendVerificationEmail({ email: "new@example.com", ip: "1.2.3.4" });
    const sent = sendTemplateEmail.mock.calls[0][0] as {
      templateData: { code: string };
    };
    authChallengeRepository.findActiveByEmail.mockResolvedValue({
      id: "challenge-1",
      email: "new@example.com",
      type: "verify",
      userId: null,
      codeHash: sha256(sent.templateData.code),
      codeExpiresAt: new Date(NOW.getTime() + 15 * 60 * 1000),
      codeAttempts: 0,
      verifiedAt: null,
      consumedAt: null,
    });

    const result = await verifyWithCode(
      { type: "verify", email: "new@example.com", code: sent.templateData.code },
      { repository: authChallengeRepository as never, now: NOW }
    );

    expect(result).toMatchObject({ ok: true });
  });
});
