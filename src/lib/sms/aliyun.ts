import "server-only";
import Client, { SendSmsVerifyCodeRequest, type SendSmsVerifyCodeResponseBody } from "@alicloud/dypnsapi20170525";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import Credential from "@alicloud/credentials";
import { normalizePhone } from "@/lib/auth/identifier";
import type { SmsSender, SmsTransportResult } from "./sender";

export interface AliyunSmsClient {
  sendSmsVerifyCode(request: SendSmsVerifyCodeRequest): Promise<{ body?: SendSmsVerifyCodeResponseBody; statusCode?: number }>;
}
export type AliyunSmsConfig = { signName?: string; registerTemplate?: string; bindTemplate?: string; schemeName?: string };
export function readAliyunSmsConfig(): AliyunSmsConfig {
  return {
    signName: process.env.ALIYUN_SMS_SIGN_NAME,
    registerTemplate: process.env.ALIYUN_SMS_TEMPLATE_CODE_REGISTER,
    bindTemplate: process.env.ALIYUN_SMS_TEMPLATE_CODE_BIND_IDENTITY,
    schemeName: process.env.ALIYUN_SMS_SCHEME_NAME,
  };
}
function createClient(): AliyunSmsClient {
  // Automated tests must explicitly inject a client; never reach a paid endpoint.
  if (process.env.NODE_ENV === "test") throw new Error("SMS tests require an injected client");
  return new Client(new $OpenApiUtil.Config({
    credential: new Credential(), endpoint: "dypnsapi.aliyuncs.com",
    protocol: "https", connectTimeout: 5000, readTimeout: 10000,
  }));
}
function failure(code: unknown): SmsTransportResult {
  switch (code) {
    case "MOBILE_NUMBER_ILLEGAL": return { ok: false, reason: "invalid_phone", providerCode: code };
    case "BUSINESS_LIMIT_CONTROL": case "FREQUENCY_FAIL":
      return { ok: false, reason: "rate_limited", providerCode: code };
    case "INVALID_PARAMETERS": case "FUNCTION_NOT_OPENED": case "InvalidAccessKeyId.NotFound":
    case "InvalidAccessKeyId": case "SignatureDoesNotMatch": case "InvalidCredentials":
      return { ok: false, reason: "unavailable", providerCode: code };
    default: return { ok: false, reason: "send_failed", providerCode: "UNKNOWN" };
  }
}

export function createAliyunSmsSender(options: {
  config?: AliyunSmsConfig; client?: AliyunSmsClient;
} = {}): SmsSender {
  return {
    async send(input) {
      const config = options.config ?? readAliyunSmsConfig();
      const template = input.purpose === "register" ? config.registerTemplate : config.bindTemplate;
      if (!config.signName?.trim() || !template?.trim()) return { ok: false, reason: "unavailable", providerCode: "NOT_CONFIGURED" };
      const phone = normalizePhone(input.phone);
      if (!phone) return { ok: false, reason: "invalid_phone", providerCode: "MOBILE_NUMBER_ILLEGAL" };
      if (!/^\d{6}$/.test(input.code)) return { ok: false, reason: "send_failed", providerCode: "INVALID_CODE" };
      try {
        const request = new SendSmsVerifyCodeRequest({
          phoneNumber: phone.slice(3), countryCode: "86", signName: config.signName,
          templateCode: template, templateParam: JSON.stringify({ code: input.code, min: "5" }),
          codeLength: 6, codeType: 1, validTime: 300, duplicatePolicy: 1,
          interval: 60, returnVerifyCode: false, autoRetry: 1, outId: input.challengeId,
          ...(config.schemeName?.trim() ? { schemeName: config.schemeName.trim() } : {}),
        });
        const response = await (options.client ?? createClient()).sendSmsVerifyCode(request);
        const body = response.body;
        if ((response.statusCode !== undefined && response.statusCode !== 200) || body?.success !== true || body?.code !== "OK") return failure(body?.code);
        const safeId = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_^.-]{1,160}$/.test(value) &&
          !value.includes(input.code) && !value.includes(phone.slice(3)) ? value : undefined;
        return { ok: true, providerCode: "OK", requestId: safeId(body.requestId), bizId: safeId(body.model?.bizId), outId: safeId(body.model?.outId) };
      } catch (error) {
        // Never forward SDK message/data/request/stack: they can contain OTP or AK.
        return failure(typeof error === "object" && error !== null && "code" in error ? error.code : undefined);
      }
    },
  };
}
