import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { findDefaultCredentialProfile } from "@/lib/profile-default";
import { createAuthIdentityRepository } from "@/lib/data/auth-identity-repository";
import { resolveChallengeTarget, resolveChallengeChannel, resolveChallengePurpose } from "@/lib/auth-challenge";
import { normalizeEmail } from "@/lib/auth/identifier";
import type {
  ChallengeTicketRow,
  RegistrationRepository,
} from "@/lib/register-user";
import type { LocalIdentityRepository } from "@/lib/auth/identity";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

class PrismaRegistrationRepository implements RegistrationRepository {
  private readonly identities: LocalIdentityRepository;

  constructor(
    private readonly client: DatabaseClient,
    private readonly rootClient: PrismaClient
  ) {
    // 身份读写走同一个 client，因此在 transaction() 内创建 email Identity
    // 与创建 User 处于同一数据库事务。
    this.identities = createAuthIdentityRepository(client);
  }

  findIdentity(input: Parameters<LocalIdentityRepository["findIdentity"]>[0]) {
    return this.identities.findIdentity(input);
  }
  findIdentitiesByUserId(userId: string) { return this.identities.findIdentitiesByUserId(userId); }
  createIdentity(input: Parameters<LocalIdentityRepository["createIdentity"]>[0]) {
    return this.identities.createIdentity(input);
  }
  async bindLegacyEmail(userId: string, email: string, verifiedAt: Date, source: string) {
    const result = await this.client.user.updateMany({
      where: { id: userId, email: null },
      data: { email, emailVerifiedAt: verifiedAt, emailVerificationSource: source },
    });
    return result.count === 1;
  }

  findEmailIdentity(providerAccountId: string) {
    return this.identities.findEmailIdentity(providerAccountId);
  }

  createEmailIdentity(input: {
    userId: string;
    providerAccountId: string;
    verifiedAt: Date | null;
    verificationSource: string;
  }) {
    return this.identities.createEmailIdentity(input);
  }

  findEmailIdentityByUserId(userId: string) {
    return this.identities.findEmailIdentityByUserId(userId);
  }

  getUserByNormalizedEmail(normalizedEmail: string) {
    return this.identities.getUserByNormalizedEmail(normalizedEmail);
  }

  async findChallengeForTicket(
    challengeId: string
  ): Promise<ChallengeTicketRow | null> {
    const row = await this.client.emailChallenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        email: true,
        target: true,
        channel: true,
        purpose: true,
        type: true,
        userId: true,
        verifiedAt: true,
        verifiedVia: true,
        ticketHash: true,
        ticketExpiresAt: true,
        ticketConsumedAt: true,
        consumedAt: true,
      },
    });
    if (!row) return null;
    // Expand 兼容：旧 Release 写入的挑战只有 legacy `email`，
    // 用统一推导得到通用 target，上层只比较规范化后的目标。
    return {
      id: row.id,
      target: resolveChallengeTarget(row),
      channel: resolveChallengeChannel(row),
      purpose: resolveChallengePurpose(row),
      userId: row.userId,
      verifiedAt: row.verifiedAt,
      verifiedVia: row.verifiedVia,
      ticketHash: row.ticketHash,
      ticketExpiresAt: row.ticketExpiresAt,
      ticketConsumedAt: row.ticketConsumedAt,
      consumedAt: row.consumedAt,
    };
  }

  async consumeTicket(input: {
    challengeId: string;
    ticketHash: string;
    now: Date;
  }): Promise<boolean> {
    const affected = await this.client.$executeRaw`
      UPDATE "EmailChallenge"
      SET "ticketConsumedAt" = ${input.now},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.challengeId}
        AND "ticketHash" = ${input.ticketHash}
        AND "ticketConsumedAt" IS NULL
        AND "ticketExpiresAt" > ${input.now}
        AND "consumedAt" IS NULL
    `;
    return affected === 1;
  }

  findDefaultCredentialProfile() {
    return findDefaultCredentialProfile(this.client);
  }

  createUser(input: {
    email: string | null;
    passwordHash: string;
    credentialProfileId: string;
    emailVerifiedAt: Date | null;
    emailVerificationSource: string;
  }) {
    return this.client.user.create({
      data: {
        email: input.email === null ? null : normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        credentialProfileId: input.credentialProfileId,
        // legacy 兼容字段：本阶段继续双写（Contract Migration 时再评估移除）
        emailVerifiedAt: input.emailVerifiedAt,
        emailVerificationSource: input.emailVerificationSource,
      },
      select: { id: true, email: true, name: true },
    });
  }

  async completeChallenge(challengeId: string, now: Date): Promise<void> {
    await this.client.emailChallenge.updateMany({
      where: { id: challengeId },
      data: { consumedAt: now },
    });
  }

  transaction<T>(
    operation: (repository: RegistrationRepository) => Promise<T>
  ): Promise<T> {
    if (this.client !== this.rootClient) {
      return operation(this);
    }

    return this.rootClient.$transaction(
      (transaction) =>
        operation(
          new PrismaRegistrationRepository(transaction, this.rootClient)
        ),
      { isolationLevel: "Serializable" }
    );
  }
}

export const registrationRepository = new PrismaRegistrationRepository(
  prisma,
  prisma
);
