import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { findDefaultCredentialProfile } from "@/lib/profile-default";
import type {
  ChallengeTicketRow,
  RegistrationRepository,
} from "@/lib/register-user";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

class PrismaRegistrationRepository implements RegistrationRepository {
  constructor(
    private readonly client: DatabaseClient,
    private readonly rootClient: PrismaClient
  ) {}

  findUserByEmail(email: string) {
    return this.client.user.findUnique({
      where: { email },
      select: { id: true },
    });
  }

  findChallengeForTicket(
    challengeId: string
  ): Promise<ChallengeTicketRow | null> {
    return this.client.emailChallenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        email: true,
        verifiedAt: true,
        verifiedVia: true,
        ticketHash: true,
        ticketExpiresAt: true,
        ticketConsumedAt: true,
        consumedAt: true,
      },
    });
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
    email: string;
    passwordHash: string;
    credentialProfileId: string;
    emailVerifiedAt: Date;
    emailVerificationSource: string;
  }) {
    return this.client.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        credentialProfileId: input.credentialProfileId,
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
