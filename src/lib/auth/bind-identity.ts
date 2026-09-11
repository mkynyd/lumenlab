import { parseLoginIdentifier, type IdentityType } from "@/lib/auth/identifier";
import { checkIdentityAvailability, type LocalIdentityRepository } from "@/lib/auth/identity";
import { consumeVerifiedIdentityTicket, RegistrationError, type RegistrationRepository } from "@/lib/register-user";

export async function assertCanBindIdentity(userId: string, target: string, type: IdentityType, repository: LocalIdentityRepository) {
  const identities = await repository.findIdentitiesByUserId(userId);
  if (identities.some((identity) => identity.type === type)) {
    throw new RegistrationError("identity_already_bound", "已绑定该类型的登录方式，本阶段不支持换绑");
  }
  // Legacy-only email users also occupy their email identity type during Expand.
  // The service self-heals the authenticated user's email before entering here.
  const availability = await checkIdentityAvailability(target, repository);
  if (availability.kind !== "available") throw new RegistrationError("identity_conflict", "该登录方式已被占用");
}

export async function bindIdentityWithTicket(input: { userId: string; identifier: string; ticket: string },
  options: { repository: RegistrationRepository; now?: Date }) {
  const identifier = parseLoginIdentifier(input.identifier);
  if (!identifier) throw new RegistrationError("identifier_invalid", "请输入有效的邮箱或大陆手机号");
  const now = options.now ?? new Date();
  return options.repository.transaction(async (repository) => {
    await assertCanBindIdentity(input.userId, identifier.providerAccountId, identifier.type, repository);
    const challenge = await consumeVerifiedIdentityTicket({
      ticket: input.ticket, target: identifier.providerAccountId, channel: identifier.channel,
      purpose: "bind_identity", userId: input.userId,
    }, repository, now);
    const identity = await repository.createIdentity({
      type: identifier.type, userId: input.userId, providerAccountId: identifier.providerAccountId,
      verifiedAt: challenge.verifiedAt, verificationSource: challenge.verifiedVia,
    });
    if (!identity) throw new RegistrationError("identity_conflict", "该登录方式已被占用");
    if (identifier.type === "email" && !await repository.bindLegacyEmail(input.userId, identifier.providerAccountId, challenge.verifiedAt, challenge.verifiedVia)) {
      throw new RegistrationError("identity_already_bound", "账户已绑定邮箱");
    }
    await repository.completeChallenge(challenge.id, now);
    return identity;
  });
}
