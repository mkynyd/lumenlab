import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendEmailMock = vi.fn();

vi.mock("tencentcloud-sdk-nodejs-ses", () => {
  class MockClient {
    constructor(public config: Record<string, unknown>) {}
    SendEmail(req: unknown) {
      return sendEmailMock(req);
    }
  }
  return {
    ses: { v20201002: { Client: MockClient, Models: {} } },
  };
});

describe("sendTemplateEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("SES_ENABLED", "1");
    vi.stubEnv("TENCENT_SECRET_ID", "secret-id");
    vi.stubEnv("TENCENT_SECRET_KEY", "secret-key");
    vi.stubEnv("SES_REGION", "ap-hongkong");
    vi.stubEnv("SES_FROM_EMAIL", "LumenLab@mail.mkynstudio.top");
    vi.stubEnv("SES_FROM_NAME", "LumenLab");
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue({ MessageId: "qcloud-ses-messageid" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function load() {
    return await import("@/lib/email/ses-client");
  }

  it("sends via the SDK with the documented parameter shape", async () => {
    const { sendTemplateEmail } = await load();
    const result = await sendTemplateEmail({
      to: "user@example.com",
      subject: "LumenLab 邮箱验证",
      templateId: "100091",
      templateData: { code: "123456", verifyUrl: "https://lab.mkynstudio.top/api/auth/verify/link?token=id.raw" },
      smtpMessageId: "<verify-challenge-1@mail.mkynstudio.top>",
      headers: { "X-Tencentcloudses-Cb-Kind": "verify" },
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith({
      FromEmailAddress: "LumenLab <LumenLab@mail.mkynstudio.top>",
      Subject: "LumenLab 邮箱验证",
      Destination: ["user@example.com"],
      Template: {
        TemplateID: 100091,
        TemplateData: JSON.stringify({
          code: "123456",
          verifyUrl:
            "https://lab.mkynstudio.top/api/auth/verify/link?token=id.raw",
        }),
      },
      TriggerType: 1,
      Unsubscribe: "0",
      SmtpMessageId: "<verify-challenge-1@mail.mkynstudio.top>",
      SmtpHeaders: JSON.stringify({ "X-Tencentcloudses-Cb-Kind": "verify" }),
    });
    expect(result).toEqual({
      ok: true,
      bulkId: "qcloud-ses-messageid",
      dryRun: false,
    });
  });

  it("maps an SDK failure to a failed result without throwing", async () => {
    sendEmailMock.mockRejectedValue(new Error("InvalidSdkSmtpReceiptHandle"));
    const { sendTemplateEmail } = await load();
    const result = await sendTemplateEmail({
      to: "user@example.com",
      subject: "LumenLab 邮箱验证",
      templateId: "100091",
      templateData: { code: "123456", verifyUrl: "https://x/verify" },
    });

    expect(result).toEqual({
      ok: false,
      error: "InvalidSdkSmtpReceiptHandle",
    });
  });

  it("falls back to dry-run and never instantiates the SDK when disabled", async () => {
    vi.stubEnv("SES_ENABLED", "0");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendTemplateEmail } = await load();
    const result = await sendTemplateEmail({
      to: "user@example.com",
      subject: "LumenLab 邮箱验证",
      templateId: "100091",
      templateData: { code: "123456", verifyUrl: "https://x/verify" },
    });

    expect(result).toEqual({ ok: true, bulkId: null, dryRun: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[email-dry-run]")
    );
    consoleSpy.mockRestore();
  });

  it("falls back to dry-run when the template id is missing", async () => {
    const { sendTemplateEmail } = await load();
    const result = await sendTemplateEmail({
      to: "user@example.com",
      subject: "LumenLab 邮箱验证",
      templateId: "",
      templateData: { code: "123456", verifyUrl: "https://x/verify" },
    });

    expect(result).toEqual({ ok: true, bulkId: null, dryRun: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
