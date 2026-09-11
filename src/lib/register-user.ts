/** Account registration and one-time proof consumption. All writes share one
 * Serializable transaction; passwords and all business relations stay on User. */
import { sha256, splitRawToken, type VerificationChannel, type VerificationPurpose } from "@/lib/auth-challenge";
import { parseLoginIdentifier } from "@/lib/auth/identifier";
import { checkIdentityAvailability, type LocalIdentityRepository } from "@/lib/auth/identity";

export type RegisteredUser = { id: string; email: string | null; name: string | null };
export interface ChallengeTicketRow {
  id: string;
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  target: string;
  userId: string | null;
  verifiedAt: Date | null;
  verifiedVia: string | null;
  ticketHash: string | null;
  ticketExpiresAt: Date | null;
  ticketConsumedAt: Date | null;
  consumedAt: Date | null;
}
export interface RegistrationRepository extends LocalIdentityRepository {
  findChallengeForTicket(challengeId: string): Promise<ChallengeTicketRow | null>;
  consumeTicket(input: { challengeId: string; ticketHash: string; now: Date }): Promise<boolean>;
  findDefaultCredentialProfile(): Promise<{ id: string } | null>;
  createUser(input: {
    email: string | null; passwordHash: string; credentialProfileId: string;
    emailVerifiedAt: Date | null; emailVerificationSource: string;
  }): Promise<RegisteredUser>;
  bindLegacyEmail(userId: string, email: string, verifiedAt: Date, source: string): Promise<boolean>;
  completeChallenge(challengeId: string, now: Date): Promise<void>;
  transaction<T>(operation: (repository: RegistrationRepository) => Promise<T>): Promise<T>;
}
export type RegistrationErrorCode = "email_exists" | "email_not_verified" | "identifier_exists" | "identifier_invalid" | "identity_already_bound" | "ticket_invalid" | "ticket_expired" | "ticket_consumed" | "profile_unavailable" | "identity_conflict";
export class RegistrationError extends Error {
  constructor(public readonly code: RegistrationErrorCode, message: string) {
    super(message); this.name = "RegistrationError";
  }
}

/** Caller must run this within its account transaction. No cross-purpose or
 * cross-owner use; generic fields were resolved from legacy columns by the adapter. */
export async function consumeVerifiedIdentityTicket(input: {
  ticket: string; target: string; channel: VerificationChannel;
  purpose: "register" | "bind_identity"; userId: string | null;
}, repository: RegistrationRepository, now: Date) {
  const split = splitRawToken(input.ticket);
  const invalid = () => new RegistrationError("ticket_invalid", "验证已失效，请重新验证");
  if (!split) throw invalid();
  const row = await repository.findChallengeForTicket(split.id);
  if (!row || row.consumedAt || row.channel !== input.channel || row.purpose !== input.purpose ||
      row.target !== input.target || row.userId !== input.userId) throw invalid();
  if (!row.verifiedAt || !row.verifiedVia) {
    throw new RegistrationError(input.channel === "email" ? "email_not_verified" : "ticket_invalid", "请先完成身份验证");
  }
  if (row.ticketHash !== sha256(split.raw)) throw invalid();
  if (row.ticketConsumedAt) throw new RegistrationError("ticket_consumed", "验证已失效，请重新验证");
  if (!row.ticketExpiresAt || row.ticketExpiresAt.getTime() <= now.getTime()) {
    throw new RegistrationError("ticket_expired", "验证已过期，请重新验证");
  }
  if (!await repository.consumeTicket({ challengeId: row.id, ticketHash: sha256(split.raw), now })) {
    throw new RegistrationError("ticket_consumed", "验证已失效，请重新验证");
  }
  return { ...row, verifiedAt: row.verifiedAt, verifiedVia: row.verifiedVia };
}

export async function registerUserWithTicket(
  input: { identifier?: string; email?: string; passwordHash: string; ticket: string },
  options: { repository: RegistrationRepository; now?: Date }
): Promise<RegisteredUser> {
  // Legacy email payload accepted until all Phase 1 clients have retired.
  const identifier = parseLoginIdentifier(input.identifier ?? input.email);
  if (!identifier) throw new RegistrationError("identifier_invalid", "请输入有效的邮箱或大陆手机号");
  const now = options.now ?? new Date();
  return options.repository.transaction(async (repository) => {
    const availability = await checkIdentityAvailability(identifier.providerAccountId, repository);
    if (availability.kind === "conflict") throw new RegistrationError("identity_conflict", "身份存在冲突，请联系管理员");
    if (availability.kind === "taken") throw new RegistrationError(identifier.type === "email" ? "email_exists" : "identifier_exists", "该登录方式已被注册");
    const challenge = await consumeVerifiedIdentityTicket({
      ticket: input.ticket, target: identifier.providerAccountId, channel: identifier.channel,
      purpose: "register", userId: null,
    }, repository, now);
    const profile = await repository.findDefaultCredentialProfile();
    if (!profile) throw new RegistrationError("profile_unavailable", "注册服务暂不可用，请稍后再试");
    const user = await repository.createUser({
      email: identifier.type === "email" ? identifier.providerAccountId : null,
      passwordHash: input.passwordHash, credentialProfileId: profile.id,
      emailVerifiedAt: identifier.type === "email" ? challenge.verifiedAt : null,
      emailVerificationSource: identifier.type === "email" ? challenge.verifiedVia : "none",
    });
    const identity = await repository.createIdentity({
      type: identifier.type, userId: user.id, providerAccountId: identifier.providerAccountId,
      verifiedAt: challenge.verifiedAt, verificationSource: challenge.verifiedVia,
    });
    if (!identity) throw new RegistrationError("identity_conflict", "该登录方式已被注册");
    await repository.completeChallenge(challenge.id, now);
    return user;
  });
}
