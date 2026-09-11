import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { authChallengeRepository as challenges } from "@/lib/data/auth-challenge-repository";
import { registrationRepository as accounts } from "@/lib/data/registration-repository";
import { authIdentityRepository as identities } from "@/lib/data/auth-identity-repository";
import { createVerificationChallenge, verifyWithCode, verifyWithLink, sha256, SMS_CODE_TTL_MS } from "@/lib/auth-challenge";
import { registerUserWithTicket } from "@/lib/register-user";
import { bindIdentityWithTicket } from "./bind-identity";
import { resolveIdentity } from "./identity";

const userIds: string[] = [], challengeIds: string[] = [];
const prefix = `phone-auth-${randomUUID()}`;
const phone = () => `+86139${randomInt(0, 100000000).toString().padStart(8, "0")}`;
const email = () => `${randomUUID()}@example.test`;
let profileId: string;
beforeAll(async () => {
  const profile = await prisma.credentialProfile.create({ data: {
    externalId: prefix, name: "Phone auth test", status: "active",
    credentials: { create: { externalId: prefix, provider: "deepseek", encryptedKey: "integration-placeholder", keyPrefix: "test", validatedAt: new Date() } },
  } });
  profileId = profile.id;
});
afterAll(async () => {
  await prisma.emailChallenge.deleteMany({ where: { id: { in: challengeIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (profileId) await prisma.credentialProfile.delete({ where: { id: profileId } });
});
async function proof(target: string, purpose: "register" | "bind_identity" = "register", userId?: string) {
  const channel = target.startsWith("+") ? "sms" as const : "email" as const;
  const start = await createVerificationChallenge({ channel, target, purpose, userId }, { repository: challenges });
  challengeIds.push(start.challengeId);
  const verified = await verifyWithCode({ channel, target, purpose, userId, code: start.code }, { repository: challenges });
  expect(verified.ok).toBe(true);
  if (!verified.ok) throw new Error("proof did not verify");
  return { ...start, ticket: verified.ticket };
}
async function register(target: string) {
  const ticket = await proof(target);
  const user = await registerUserWithTicket({ identifier: target, ticket: ticket.ticket, passwordHash: "unchanged-account-hash" }, { repository: accounts });
  userIds.push(user.id);
  return user;
}

describe("Phone accounts on PostgreSQL", () => {
  it("registers two phone-only users with real NULL email and account password; resolves through identity only", async () => {
    for (let i = 0; i < 2; i++) {
      const target = phone(); const user = await register(target);
      expect(user.email).toBeNull();
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored).toMatchObject({ email: null, emailVerifiedAt: null, emailVerificationSource: "none", passwordHash: "unchanged-account-hash", accessStatus: "active" });
      expect(stored.credentialProfileId).not.toBeNull();
      const row = await resolveIdentity(target, identities);
      expect(row).toMatchObject({ kind: "resolved", userId: user.id, selfHealed: false, identity: { type: "phone", providerAccountId: target } });
    }
  });
  it("supports email to phone binding and rejects account merge and a second same-type alias", async () => {
    const user = await register(email()); const target = phone(); const ticket = await proof(target, "bind_identity", user.id);
    await bindIdentityWithTicket({ userId: user.id, identifier: target, ticket: ticket.ticket }, { repository: accounts });
    expect(await identities.findIdentitiesByUserId(user.id)).toHaveLength(2);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(before.passwordHash).toBe("unchanged-account-hash");
    await expect(bindIdentityWithTicket({ userId: user.id, identifier: phone(), ticket: ticket.ticket }, { repository: accounts })).rejects.toMatchObject({ code: "identity_already_bound" });
    const other = await register(email());
    await expect(bindIdentityWithTicket({ userId: other.id, identifier: target, ticket: ticket.ticket }, { repository: accounts })).rejects.toMatchObject({ code: "identity_conflict" });
    expect(await identities.findIdentitiesByUserId(other.id)).toHaveLength(1);
    expect(await identities.findIdentity({ type: "phone", provider: "local", providerAccountId: target })).toMatchObject({ userId: user.id });
  });
  it("binds an email to a phone account, dual-writes legacy verification, and resolves both to the same User", async () => {
    const targetPhone = phone(); const user = await register(targetPhone); const targetEmail = email();
    const ticket = await proof(targetEmail, "bind_identity", user.id);
    expect(ticket.rawToken).toBeNull();
    await bindIdentityWithTicket({ userId: user.id, identifier: targetEmail.toUpperCase(), ticket: ticket.ticket }, { repository: accounts });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored).toMatchObject({ email: targetEmail, emailVerificationSource: "code", passwordHash: "unchanged-account-hash", passwordChangedAt: null });
    const emailIdentity = await identities.findEmailIdentity(targetEmail);
    expect(stored.emailVerifiedAt).toEqual(emailIdentity?.verifiedAt);
    for (const target of [targetPhone, targetEmail]) expect(await resolveIdentity(target, identities)).toMatchObject({ userId: user.id });
  });
  it("rejects register/bind/channel/target/userId swaps without consuming the valid proof", async () => {
    const owner = await register(email()); const stranger = await register(email()); const target = phone();
    const ticket = await proof(target, "bind_identity", owner.id);
    await expect(registerUserWithTicket({ identifier: target, ticket: ticket.ticket, passwordHash: "hash" }, { repository: accounts })).rejects.toMatchObject({ code: "ticket_invalid" });
    await expect(bindIdentityWithTicket({ userId: stranger.id, identifier: target, ticket: ticket.ticket }, { repository: accounts })).rejects.toMatchObject({ code: "ticket_invalid" });
    await expect(bindIdentityWithTicket({ userId: owner.id, identifier: phone(), ticket: ticket.ticket }, { repository: accounts })).rejects.toMatchObject({ code: "ticket_invalid" });
    const registerProof = await proof(phone());
    await expect(bindIdentityWithTicket({ userId: owner.id, identifier: target, ticket: registerProof.ticket }, { repository: accounts })).rejects.toMatchObject({ code: "ticket_invalid" });
    expect(await prisma.emailChallenge.findUnique({ where: { id: ticket.challengeId } })).toMatchObject({ ticketConsumedAt: null });
    await bindIdentityWithTicket({ userId: owner.id, identifier: target, ticket: ticket.ticket }, { repository: accounts });
  });
  it("keeps SMS OTP lifetime at 5 minutes, no link, 5 attempts and one successful claim", async () => {
    const target = phone(); const now = new Date();
    const start = await createVerificationChallenge({ channel: "sms", purpose: "register", target }, { repository: challenges, now });
    challengeIds.push(start.challengeId);
    const stored = await prisma.emailChallenge.findUniqueOrThrow({ where: { id: start.challengeId } });
    expect(+stored.codeExpiresAt - +now).toBe(SMS_CODE_TTL_MS);
    expect(stored).toMatchObject({ channel: "sms", target, email: target, type: "sms_register", tokenHash: null, tokenExpiresAt: null, codeHash: sha256(start.code) });
    expect(await verifyWithLink({ token: `${start.challengeId}.anything` }, { repository: challenges })).toMatchObject({ ok: false });
    for (let i = 0; i < 5; i++) await verifyWithCode({ channel: "sms", purpose: "register", target, code: start.code === "000000" ? "111111" : "000000" }, { repository: challenges });
    expect(await verifyWithCode({ channel: "sms", purpose: "register", target, code: start.code }, { repository: challenges })).toMatchObject({ ok: false });
    expect(await prisma.emailChallenge.findUnique({ where: { id: start.challengeId } })).toMatchObject({ codeAttempts: 5, consumedAt: expect.any(Date) });
    const replacement = await proof(target);
    expect(await verifyWithCode({ channel: "sms", purpose: "register", target, code: replacement.code }, { repository: challenges })).toMatchObject({ ok: false });
    const expired = await createVerificationChallenge({ channel: "sms", purpose: "register", target: phone() }, { repository: challenges, now: new Date(Date.now() - SMS_CODE_TTL_MS - 1) });
    challengeIds.push(expired.challengeId);
    const expiredRow = await prisma.emailChallenge.findUniqueOrThrow({ where: { id: expired.challengeId } });
    expect(await verifyWithCode({ channel: "sms", purpose: "register", target: expiredRow.target!, code: expired.code }, { repository: challenges })).toMatchObject({ reason: "expired" });
  });
  it("old email challenges remain usable; generic queries do not invalidate a different purpose", async () => {
    const user = await register(phone()); const target = email();
    const old = await prisma.emailChallenge.create({ data: { email: target, type: "verify", codeHash: sha256("123456"), codeExpiresAt: new Date(Date.now() + 900000), tokenHash: sha256(randomUUID()) } });
    challengeIds.push(old.id);
    const binding = await proof(target, "bind_identity", user.id);
    const verified = await verifyWithCode({ email: target, purpose: "register", code: "123456" }, { repository: challenges });
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("old proof failed");
    const registered = await registerUserWithTicket({ email: target, passwordHash: "old-client-hash", ticket: verified.ticket }, { repository: accounts });
    userIds.push(registered.id);
    await expect(bindIdentityWithTicket({ userId: user.id, identifier: target, ticket: binding.ticket }, { repository: accounts })).rejects.toMatchObject({ code: "identity_conflict" });
  });
});

it("enforces real Redis 60-second resend reservations and closes failed sends without a paid provider", async () => {
  const { sendVerificationSms } = await import("@/lib/sms/service");
  const { vi } = await import("vitest");
  const target = phone();
  const sender = { send: vi.fn().mockResolvedValue({ ok: false, reason: "send_failed", providerCode: "UNKNOWN" }) };
  try {
    expect(await sendVerificationSms({ phone: target, purpose: "register", ip: prefix }, { sender })).toMatchObject({ ok: false, reason: "send_failed" });
    expect(await sendVerificationSms({ phone: target, purpose: "register", ip: prefix }, { sender })).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(await prisma.emailChallenge.findFirst({ where: { target } })).toMatchObject({ consumedAt: expect.any(Date) });
  } finally { await prisma.emailChallenge.deleteMany({ where: { target } }); }
});
