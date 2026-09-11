import { describe, expect, it, vi } from "vitest";
import { consumeVerifiedIdentityTicket, type ChallengeTicketRow, type RegistrationRepository } from "@/lib/register-user";
import { sha256 } from "@/lib/auth-challenge";
const now = new Date();
const context = { ticket: "proof.raw", target: "+8613812345678", channel: "sms" as const, purpose: "bind_identity" as const, userId: "owner" };
const row: ChallengeTicketRow = { id: "proof", target: context.target, channel: "sms", purpose: "bind_identity", userId: "owner", verifiedAt: now, verifiedVia: "code", ticketHash: sha256("raw"), ticketExpiresAt: new Date(+now + 60000), ticketConsumedAt: null, consumedAt: null };
describe("proof boundaries", () => {
  it.each([
    { channel: "email" }, { purpose: "register" }, { purpose: "password_reset" },
    { target: "+8613912345678" }, { userId: "other" }, { userId: null },
    { consumedAt: now }, { ticketConsumedAt: now }, { ticketHash: sha256("other") },
    { ticketExpiresAt: now }, { verifiedAt: null },
  ] satisfies Partial<ChallengeTicketRow>[])("refuses a mismatched/invalid proof: %j", async (patch) => {
    const consumeTicket = vi.fn().mockResolvedValue(true);
    const repo = { findChallengeForTicket: vi.fn().mockResolvedValue({ ...row, ...patch }), consumeTicket } as unknown as RegistrationRepository;
    await expect(consumeVerifiedIdentityTicket(context, repo, now)).rejects.toThrow();
    expect(consumeTicket).not.toHaveBeenCalled();
  });
  it("register cannot consume an owner-bound proof even if channel and target match", async () => {
    const repo = { findChallengeForTicket: vi.fn().mockResolvedValue(row), consumeTicket: vi.fn() } as unknown as RegistrationRepository;
    await expect(consumeVerifiedIdentityTicket({ ...context, purpose: "register", userId: null }, repo, now)).rejects.toMatchObject({ code: "ticket_invalid" });
  });
});
