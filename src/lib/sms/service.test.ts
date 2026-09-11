// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/data/auth-challenge-repository", () => ({ authChallengeRepository: {} }));
import { sendVerificationSms } from "./service";
import { sha256, type AuthChallengeRepository } from "@/lib/auth-challenge";
import type { checkRateLimit } from "@/lib/rate-limit";

const input = { phone: "13812345678", purpose: "register" as const, ip: "192.0.2.1" };
function fixture() {
  const repository = { invalidateActiveChallenges: vi.fn(), createChallenge: vi.fn().mockResolvedValue({ id: "challenge-id" }), completeChallenge: vi.fn() } as unknown as AuthChallengeRepository;
  const sender = { send: vi.fn().mockResolvedValue({ ok: true, providerCode: "OK" }) };
  const rateLimit = vi.fn<typeof checkRateLimit>().mockResolvedValue({ allowed: true, remaining: 1, resetTime: Date.now() + 60000 });
  return { repository, sender, rateLimit };
}
afterEach(() => vi.restoreAllMocks());
describe("SMS sending safety", () => {
  it("reserves cooldown, daily target and IP budgets before sending; stores only a hash", async () => {
    const options = fixture();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await sendVerificationSms(input, options)).toEqual({ ok: true, resendAfter: 60 });
    expect(options.rateLimit.mock.calls.map((call) => call.slice(1, 3))).toEqual([[1, 60000], [10, 86400000], [5, 600000]]);
    expect(options.rateLimit).toHaveBeenCalledWith(`sms:resend:register:${sha256("+8613812345678")}`, 1, 60000, { requireRedis: true });
    expect(options.rateLimit.mock.invocationCallOrder[2]).toBeLessThan(options.sender.send.mock.invocationCallOrder[0]);
    const sent = options.sender.send.mock.calls[0][0];
    expect(sent.code).toMatch(/^\d{6}$/);
    expect(options.repository.createChallenge).toHaveBeenCalledWith(expect.objectContaining({ channel: "sms", email: "+8613812345678", codeHash: sha256(sent.code), tokenHash: null, tokenExpiresAt: null }));
    const logs = JSON.stringify(log.mock.calls);
    expect(logs).toContain("+86138****5678");
    for (const secret of [input.phone, sent.code, "TemplateParam"]) expect(logs).not.toContain(secret);
    expect(options.repository.completeChallenge).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2])("refuses transport when budget %i is exhausted", async (index) => {
    const options = fixture();
    for (let n = 0; n < index; n++) options.rateLimit.mockResolvedValueOnce({ allowed: true, remaining: 1, resetTime: Date.now() + 60000 });
    options.rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: Date.now() + 60000 });
    expect(await sendVerificationSms(input, options)).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(options.sender.send).not.toHaveBeenCalled();
    expect(options.repository.createChallenge).not.toHaveBeenCalled();
  });
  it("fails closed when Redis is unavailable", async () => {
    const options = fixture();
    options.rateLimit.mockResolvedValue({ allowed: false, unavailable: true, remaining: 0, resetTime: Date.now() + 30000 });
    expect(await sendVerificationSms(input, options)).toMatchObject({ reason: "unavailable" });
    expect(options.sender.send).not.toHaveBeenCalled();
  });
  it.each([false, true])("closes the exact challenge on failed response or throw (%s)", async (throws) => {
    const options = fixture();
    if (throws) options.sender.send.mockRejectedValue(new Error("secret provider payload"));
    else options.sender.send.mockResolvedValue({ ok: false, reason: "send_failed", providerCode: "UNKNOWN" });
    expect(await sendVerificationSms(input, options)).toMatchObject({ ok: false, reason: "send_failed" });
    expect(options.repository.completeChallenge).toHaveBeenCalledWith("challenge-id", expect.any(Date));
  });
});
