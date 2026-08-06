/**
 * 腾讯云 SES（香港 ap-hongkong）HTTPS API 发信客户端。
 *
 * 未启用（SES_ENABLED !== "1"）、缺凭据或缺模板 ID 时降级为 dry-run：
 * 打印邮件内容并返回成功（bulkId 为空），保证本地开发与未建模板时不崩溃。
 * 邮件发送走官方 SDK（tencentcloud-sdk-nodejs-ses），不依赖 SMTP。
 */

import "server-only";
import { ses } from "tencentcloud-sdk-nodejs-ses";
import { buildFromEmailAddress } from "@/lib/email/templates";

export interface SendTemplateEmailInput {
  to: string;
  subject: string;
  templateId: string;
  templateData: Record<string, string>;
  /** 自定义 RFC5322 Message-ID（<id@domain>），回调 messageId 可回链业务 */
  smtpMessageId?: string;
  /** X-Tencentcloudses-Cb- 前缀自定义头，回调原样带回 */
  headers?: Record<string, string>;
}

export type SendTemplateEmailResult =
  | { ok: true; bulkId: string | null; dryRun: boolean }
  | { ok: false; error: string };

function sesEnabled(): boolean {
  return process.env.SES_ENABLED === "1";
}

function hasCredentials(): boolean {
  return Boolean(
    process.env.TENCENT_SECRET_ID?.trim() &&
      process.env.TENCENT_SECRET_KEY?.trim()
  );
}

let clientInstance: InstanceType<typeof ses.v20201002.Client> | null = null;

function getClient() {
  if (!clientInstance) {
    clientInstance = new ses.v20201002.Client({
      credential: {
        secretId: process.env.TENCENT_SECRET_ID!,
        secretKey: process.env.TENCENT_SECRET_KEY!,
      },
      region: process.env.SES_REGION?.trim() || "ap-hongkong",
    });
  }
  return clientInstance;
}

export async function sendTemplateEmail(
  input: SendTemplateEmailInput
): Promise<SendTemplateEmailResult> {
  if (!sesEnabled() || !hasCredentials() || !input.templateId) {
    console.log(
      `[email-dry-run] to=${input.to} subject=${input.subject} templateId=${input.templateId ?? "none"} data=${JSON.stringify(
        input.templateData
      )} messageId=${input.smtpMessageId ?? "none"}`
    );
    return { ok: true, bulkId: null, dryRun: true };
  }

  try {
    const response = await getClient().SendEmail({
      FromEmailAddress: buildFromEmailAddress(),
      Subject: input.subject,
      Destination: [input.to],
      Template: {
        TemplateID: Number(input.templateId),
        TemplateData: JSON.stringify(input.templateData),
      },
      TriggerType: 1, // 触发类：验证码等即时发送
      Unsubscribe: "0", // 交易/触发类邮件不加入退订链接
      SmtpMessageId: input.smtpMessageId,
      SmtpHeaders: input.headers ? JSON.stringify(input.headers) : undefined,
    });
    return { ok: true, bulkId: response.MessageId ?? null, dryRun: false };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
