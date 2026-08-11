import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  emailLogCreate: vi.fn(),
  emailLogUpdate: vi.fn(),
  sendTemplateEmail: vi.fn(),
  getAdminEmails: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    emailLog: {
      create: mocks.emailLogCreate,
      update: mocks.emailLogUpdate,
    },
  },
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...original, checkRateLimit: mocks.checkRateLimit };
});
vi.mock("@/lib/email/ses-client", () => ({
  sendTemplateEmail: mocks.sendTemplateEmail,
}));
vi.mock("@/lib/admin", () => ({
  getAdminEmails: mocks.getAdminEmails,
}));

import { sendFeedbackNotificationEmail } from "@/lib/email/feedback-notify";

const baseInput = {
  feedbackId: "fb-1",
  category: "bug",
  userEmail: "u1@example.com",
  content: "导出 PDF 时卡住",
  pagePath: "/chat",
  contact: null as string | null,
};

describe("sendFeedbackNotificationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminEmails.mockReturnValue(["a1@example.com", "a2@example.com"]);
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 49, resetTime: 0 });
    mocks.emailLogCreate.mockResolvedValue({ id: "log-1" });
    mocks.emailLogUpdate.mockResolvedValue({});
    mocks.sendTemplateEmail.mockResolvedValue({ ok: true, bulkId: "bulk-1", dryRun: false });
  });

  it("给每个管理员邮箱发邮件，templateData 含中文分类标签与默认联系方式", async () => {
    await sendFeedbackNotificationEmail(baseInput);

    expect(mocks.sendTemplateEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a1@example.com",
        subject: "LumenLab 用户反馈通知",
        smtpMessageId: "<feedback-notify-fb-1@mail.mkynstudio.top>",
        templateData: expect.objectContaining({
          category: "Bug",
          userEmail: "u1@example.com",
          pagePath: "/chat",
          contact: "未填写",
          content: "导出 PDF 时卡住",
          time: expect.any(String),
        }),
      })
    );
    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "a2@example.com" })
    );
  });

  it("suggestion 分类映射为功能建议，contact 有值时透传", async () => {
    await sendFeedbackNotificationEmail({
      ...baseInput,
      category: "suggestion",
      contact: "qq 123",
    });

    expect(mocks.sendTemplateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateData: expect.objectContaining({
          category: "功能建议",
          contact: "qq 123",
        }),
      })
    );
  });

  it("每个收件人都写 EmailLog（kind feedback-notify，event sending → sent）", async () => {
    mocks.emailLogCreate
      .mockResolvedValueOnce({ id: "log-1" })
      .mockResolvedValueOnce({ id: "log-2" });

    await sendFeedbackNotificationEmail(baseInput);

    expect(mocks.emailLogCreate).toHaveBeenCalledTimes(2);
    expect(mocks.emailLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "feedback-notify",
        email: "a1@example.com",
        event: "sending",
      }),
      select: { id: true },
    });
    expect(mocks.emailLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "feedback-notify",
        email: "a2@example.com",
        event: "sending",
      }),
      select: { id: true },
    });
    expect(mocks.emailLogUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.emailLogUpdate).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: expect.objectContaining({ event: "sent", bulkId: "bulk-1" }),
    });
    expect(mocks.emailLogUpdate).toHaveBeenCalledWith({
      where: { id: "log-2" },
      data: expect.objectContaining({ event: "sent", bulkId: "bulk-1" }),
    });
  });

  it("ADMIN_EMAILS 为空时不发送、不写日志", async () => {
    mocks.getAdminEmails.mockReturnValue([]);

    await sendFeedbackNotificationEmail(baseInput);

    expect(mocks.sendTemplateEmail).not.toHaveBeenCalled();
    expect(mocks.emailLogCreate).not.toHaveBeenCalled();
  });

  it("限流拒绝时不发送", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetTime: 0 });

    await sendFeedbackNotificationEmail(baseInput);

    expect(mocks.checkRateLimit).toHaveBeenCalledWith("feedback-notify", 50, 86_400_000);
    expect(mocks.sendTemplateEmail).not.toHaveBeenCalled();
    expect(mocks.emailLogCreate).not.toHaveBeenCalled();
  });

  it("sendTemplateEmail 失败时 EmailLog 更新为 failed、console.error、不抛出", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendTemplateEmail.mockResolvedValue({ ok: false, error: "SES quota exceeded" });

    await expect(sendFeedbackNotificationEmail(baseInput)).resolves.toBeUndefined();

    expect(mocks.emailLogUpdate).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { event: "failed", payload: { error: "SES quota exceeded" } },
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("prisma.emailLog.create 抛异常时整个函数仍 resolve（不抛出）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.emailLogCreate.mockRejectedValue(new Error("db down"));

    await expect(sendFeedbackNotificationEmail(baseInput)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
