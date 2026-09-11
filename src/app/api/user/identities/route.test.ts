import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(), list: vi.fn(), canBind: vi.fn(), sms: vi.fn(), email: vi.fn(), verify: vi.fn(), bind: vi.fn(), rate: vi.fn(),
}));
vi.mock("@/lib/auth/identity-settings", () => ({ identitySettingsUser: mocks.user }));
vi.mock("@/lib/auth/service", () => ({ authIdentityRepository: { findIdentitiesByUserId: mocks.list } }));
vi.mock("@/lib/auth/bind-identity", () => ({ assertCanBindIdentity: mocks.canBind, bindIdentityWithTicket: mocks.bind }));
vi.mock("@/lib/sms/service", () => ({ sendVerificationSms: mocks.sms }));
vi.mock("@/lib/email/service", () => ({ sendVerificationEmail: mocks.email }));
vi.mock("@/lib/auth-challenge", async (original) => ({ ...await original<typeof import("@/lib/auth-challenge")>(), verifyWithCode: mocks.verify }));
vi.mock("@/lib/data/registration-repository", () => ({ registrationRepository: {} }));
vi.mock("@/lib/data/auth-challenge-repository", () => ({ authChallengeRepository: {} }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate, RateLimits: { REGISTER: { max: 3, window: 60000 }, VERIFY_CODE_IP: { max: 10, window: 900000 } } }));
import { GET } from "./route";
import { POST as send } from "./send/route";
import { POST as verify } from "./code/route";
import { POST as bind } from "./bind/route";
const request = (body: object = {}) => new Request("http://localhost/api/user/identities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "owner", email: null }); mocks.list.mockResolvedValue([]);
  mocks.canBind.mockResolvedValue(undefined); mocks.sms.mockResolvedValue({ ok: true, resendAfter: 60 }); mocks.email.mockResolvedValue({ ok: true });
  mocks.verify.mockResolvedValue({ ok: true, ticket: "proof.raw" }); mocks.bind.mockResolvedValue({}); mocks.rate.mockResolvedValue({ allowed: true });
});
describe("authenticated identities", () => {
  it("requires a live session on every endpoint", async () => {
    mocks.user.mockResolvedValue(null);
    for (const response of [await GET(), await send(request()), await verify(request()), await bind(request())]) expect(response.status).toBe(401);
    expect(mocks.sms).not.toHaveBeenCalled(); expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("returns masked identity status only", async () => {
    mocks.list.mockResolvedValue([{ type: "phone", provider: "local", providerAccountId: "+8613812345678", verifiedAt: new Date() }]);
    expect(await (await GET()).json()).toEqual({ identities: [{ type: "phone", maskedValue: "+86138****5678", verified: true }] });
  });
  it("always binds sending and verification to the session owner", async () => {
    expect((await send(request({ identifier: "13812345678", userId: "attacker" }))).status).toBe(200);
    expect(mocks.sms).toHaveBeenCalledWith({ phone: "+8613812345678", purpose: "bind_identity", userId: "owner", ip: "unknown" });
    expect((await verify(request({ identifier: "13812345678", code: "123456", userId: "attacker", purpose: "register" }))).status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith({ target: "+8613812345678", channel: "sms", purpose: "bind_identity", userId: "owner", code: "123456" }, expect.anything());
    expect((await bind(request({ identifier: "13812345678", ticket: "proof.raw", userId: "attacker" }))).status).toBe(200);
    expect(mocks.bind).toHaveBeenCalledWith({ identifier: "13812345678", ticket: "proof.raw", userId: "owner" }, expect.anything());
  });
  it("uses the code-only email binding transport", async () => {
    expect((await send(request({ identifier: " New@Example.com " }))).status).toBe(200);
    expect(mocks.email).toHaveBeenCalledWith({ email: "new@example.com", purpose: "bind_identity", userId: "owner", ip: "unknown" });
    expect(mocks.sms).not.toHaveBeenCalled();
  });
  it.each([["rate_limited", 429], ["unavailable", 503], ["invalid_phone", 400], ["send_failed", 502]] as const)("maps SMS %s to %s", async (reason, status) => {
    mocks.sms.mockResolvedValue({ ok: false, reason });
    expect((await send(request({ identifier: "13812345678" }))).status).toBe(status);
  });
});
