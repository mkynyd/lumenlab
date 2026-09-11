// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { SendSmsVerifyCodeResponseBody } from "@alicloud/dypnsapi20170525";
import { createAliyunSmsSender } from "./aliyun";
const input = { phone: "+8613812345678", code: "012345", purpose: "register" as const, challengeId: "challenge-id" };
const config = { signName: "test-sign", registerTemplate: "test-register", bindTemplate: "test-bind" };

describe("Aliyun SMS adapter (injected only; no network)", () => {
  it("sends exactly the locally generated OTP and configured policy", async () => {
    const sendSmsVerifyCode = vi.fn().mockResolvedValue({ statusCode: 200, body: new SendSmsVerifyCodeResponseBody({ success: true, code: "OK", requestId: "request-id", model: { bizId: "biz-id", outId: "challenge-id", verifyCode: input.code } }) });
    const result = await createAliyunSmsSender({ config, client: { sendSmsVerifyCode } }).send(input);
    expect({ ...sendSmsVerifyCode.mock.calls[0][0] }).toEqual({
      phoneNumber: "13812345678", countryCode: "86", signName: "test-sign", templateCode: "test-register",
      templateParam: JSON.stringify({ code: "012345", min: "5" }), codeLength: 6, codeType: 1,
      validTime: 300, duplicatePolicy: 1, interval: 60, returnVerifyCode: false, autoRetry: 1, outId: "challenge-id",
    });
    expect(result).toEqual({ ok: true, providerCode: "OK", requestId: "request-id", bizId: "biz-id", outId: "challenge-id" });
    expect(JSON.stringify(result)).not.toContain(input.code);
  });
  it("maps bind template and includes SchemeName only when configured", async () => {
    const sendSmsVerifyCode = vi.fn().mockResolvedValue({ body: { success: true, code: "OK" } });
    await createAliyunSmsSender({ config: { ...config, schemeName: "scheme" }, client: { sendSmsVerifyCode } }).send({ ...input, purpose: "bind_identity" });
    expect(sendSmsVerifyCode.mock.calls[0][0]).toMatchObject({ templateCode: "test-bind", schemeName: "scheme" });
  });
  it.each([
    ["MOBILE_NUMBER_ILLEGAL", "invalid_phone"], ["BUSINESS_LIMIT_CONTROL", "rate_limited"],
    ["FREQUENCY_FAIL", "rate_limited"], ["INVALID_PARAMETERS", "unavailable"], ["FUNCTION_NOT_OPENED", "unavailable"],
    ["SECRET_MESSAGE_13812345678_012345", "send_failed"],
  ])("sanitizes business and SDK failures %s", async (code, reason) => {
    for (const throws of [false, true]) {
      const sendSmsVerifyCode = throws ? vi.fn().mockRejectedValue({ code, message: `${input.phone} ${input.code}`, data: { TemplateParam: input.code } }) : vi.fn().mockResolvedValue({ statusCode: 200, body: { success: false, code, message: input.code } });
      const result = await createAliyunSmsSender({ config, client: { sendSmsVerifyCode } }).send(input);
      expect(result).toMatchObject({ ok: false, reason });
      expect(JSON.stringify(result)).not.toContain(input.phone);
      expect(JSON.stringify(result)).not.toContain(input.code);
    }
  });
  it.each([{ success: true, code: "NO" }, { success: false, code: "OK" }, { code: "OK" }, {}])("requires both success=true and code=OK", async (body) => {
    const client = { sendSmsVerifyCode: vi.fn().mockResolvedValue({ body }) };
    expect(await createAliyunSmsSender({ config, client }).send(input)).toMatchObject({ ok: false });
  });
  it("rejects HTTP errors, missing config, invalid phone and code before transport", async () => {
    const client = { sendSmsVerifyCode: vi.fn().mockResolvedValue({ statusCode: 500, body: { success: true, code: "OK" } }) };
    expect(await createAliyunSmsSender({ config, client }).send(input)).toMatchObject({ ok: false });
    client.sendSmsVerifyCode.mockClear();
    expect(await createAliyunSmsSender({ config: {}, client }).send(input)).toMatchObject({ reason: "unavailable" });
    expect(await createAliyunSmsSender({ config, client }).send({ ...input, phone: "bad" })).toMatchObject({ reason: "invalid_phone" });
    expect(await createAliyunSmsSender({ config, client }).send({ ...input, code: "##code##" })).toMatchObject({ ok: false });
    expect(client.sendSmsVerifyCode).not.toHaveBeenCalled();
  });
  it("blocks the default network client in automated tests", async () => {
    expect(await createAliyunSmsSender({ config }).send(input)).toMatchObject({ ok: false });
  });
});
