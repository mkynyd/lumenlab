import "server-only";

export type SmsPurpose = "register" | "bind_identity";
export type SmsFailure = "invalid_phone" | "rate_limited" | "unavailable" | "send_failed";
export type SmsTransportResult = {
  ok: true; providerCode: "OK"; requestId?: string; bizId?: string; outId?: string;
} | { ok: false; reason: SmsFailure; providerCode: string };
export interface SmsSender {
  send(input: { phone: string; code: string; purpose: SmsPurpose; challengeId: string }): Promise<SmsTransportResult>;
}
