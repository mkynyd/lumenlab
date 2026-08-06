/**
 * 腾讯云 SES 邮件模板配置。
 *
 * 模板 ID 来自 SES 控制台（审核通过后），走环境变量注入；
 * 缺失时由 ses-client 降级为 dry-run，不阻断本地开发。
 * 模板变量使用腾讯云格式 {{code}} / {{verifyUrl}} / {{resetUrl}}。
 */

export type EmailKind = "verify" | "reset";

export function getTemplateId(kind: EmailKind): string | null {
  const value =
    kind === "verify"
      ? process.env.SES_TEMPLATE_VERIFY
      : process.env.SES_TEMPLATE_RESET;
  return value?.trim() ? value.trim() : null;
}

/** 链接 base URL：显式环境变量优先，默认由 AUTH_URL 推导 */
function linkBaseUrl(envKey: string, fallbackPath: string): string {
  const explicit = process.env[envKey]?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const authUrl = process.env.AUTH_URL?.trim() || "";
  if (authUrl) return authUrl.replace(/\/+$/, "") + fallbackPath;
  return fallbackPath;
}

export function buildVerifyUrl(challengeId: string, rawToken: string): string {
  const base = linkBaseUrl("SES_VERIFY_URL_BASE", "/api/auth/verify/link");
  return `${base}?token=${encodeURIComponent(`${challengeId}.${rawToken}`)}`;
}

export function buildResetUrl(challengeId: string, rawToken: string): string {
  const base = linkBaseUrl("SES_RESET_URL_BASE", "/api/auth/password/reset-link");
  return `${base}?token=${encodeURIComponent(`${challengeId}.${rawToken}`)}`;
}

export function buildVerifyTemplateData(
  code: string,
  verifyUrl: string
): Record<string, string> {
  return { code, verifyUrl };
}

export function buildResetTemplateData(
  resetUrl: string
): Record<string, string> {
  return { resetUrl };
}

export function buildVerifySubject(): string {
  return "LumenLab 邮箱验证";
}

export function buildResetSubject(): string {
  return "LumenLab 密码重设";
}

/** 发件人（别名 + 空格 + 邮箱，腾讯云格式） */
export function buildFromEmailAddress(): string {
  const name = process.env.SES_FROM_NAME?.trim() || "LumenLab";
  const email = process.env.SES_FROM_EMAIL?.trim() || "LumenLab@mail.mkynstudio.top";
  return `${name} <${email}>`;
}
