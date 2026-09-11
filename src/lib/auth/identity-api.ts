import "server-only";
import { NextResponse } from "next/server";
import type { SendSmsResult } from "@/lib/sms/service";

export function smsFailureResponse(result: Extract<SendSmsResult, { ok: false }>) {
  const status = { invalid_phone: 400, rate_limited: 429, unavailable: 503, send_failed: 502 }[result.reason];
  const message = { invalid_phone: "手机号格式不正确", rate_limited: "发送太频繁，请稍后再试", unavailable: "短信服务暂不可用", send_failed: "短信发送失败，请稍后重试" }[result.reason];
  return NextResponse.json({ error: message, ...(result.retryAfter ? { resendAfter: result.retryAfter } : {}) }, {
    status, ...(status === 429 ? { headers: { "Retry-After": String(result.retryAfter ?? 60) } } : {}),
  });
}
