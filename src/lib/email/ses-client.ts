/**
 * 腾讯云 SES（香港 ap-hongkong）HTTPS API 发信客户端。
 *
 * 未启用（SES_ENABLED !== "1"）、缺凭据或缺模板 ID 时：
 * - 非生产环境降级为 dry-run（bulkId 为空、返回成功），保证本地开发不崩溃；
 * - 生产环境 fail closed。静默 dry-run 会让验证邮件全部丢失却仍向用户报成功，
 *   且把验证码写进 journal，因此生产必须暴露失败而不是伪装成功。
 * 日志永不输出模板变量的取值，只输出字段名；本地需要真实取值时显式设置
 * SES_DRY_RUN_VERBOSE=1（生产环境忽略该开关）。
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

/** dry-run 是本地开发兜底，生产环境必须 fail closed。 */
function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/** 默认只输出模板变量名；本地调试需要真实取值时显式开启，生产环境忽略该开关。 */
function dryRunDataDetail(templateData: Record<string, string>): string {
  if (process.env.SES_DRY_RUN_VERBOSE === "1" && !isProductionRuntime()) {
    return `data=${JSON.stringify(templateData)}`;
  }
  return `dataKeys=${Object.keys(templateData).join(",")}`;
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
    if (isProductionRuntime()) {
      return { ok: false, error: "SES_NOT_CONFIGURED" };
    }
    console.log(
      `[email-dry-run] to=${input.to} subject=${input.subject} templateId=${input.templateId ?? "none"} ${dryRunDataDetail(
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
