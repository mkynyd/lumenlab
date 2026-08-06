import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type {
  AuthChallengeRepository,
  ChallengeForTicketRow,
  EmailChallengeRow,
  EmailChallengeTokenRow,
} from "@/lib/auth-challenge";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

class PrismaAuthChallengeRepository implements AuthChallengeRepository {
  constructor(
    private readonly client: DatabaseClient,
    private readonly rootClient: PrismaClient
  ) {}

  async invalidateActiveChallenges(
    email: string,
    type: string,
    now: Date
  ): Promise<void> {
    await this.client.emailChallenge.updateMany({
      where: { email, type, consumedAt: null },
      data: { consumedAt: now },
    });
  }

  createChallenge(input: {
    type: string;
    email: string;
    userId?: string;
    codeHash: string;
    codeExpiresAt: Date;
    tokenHash: string;
    tokenExpiresAt: Date;
  }) {
    return this.client.emailChallenge.create({
      data: {
        type: input.type,
        email: input.email,
        userId: input.userId ?? null,
        codeHash: input.codeHash,
        codeExpiresAt: input.codeExpiresAt,
        tokenHash: input.tokenHash,
        tokenExpiresAt: input.tokenExpiresAt,
      },
      select: { id: true },
    });
  }

  findActiveByEmail(
    email: string,
    type: string
  ): Promise<EmailChallengeRow | null> {
    return this.client.emailChallenge.findFirst({
      where: { email, type, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  async incrementCodeAttempt(
    id: string,
    maxAttempts: number,
    now: Date
  ): Promise<boolean> {
    const affected = await this.client.$executeRaw`
      UPDATE "EmailChallenge"
      SET "codeAttempts" = "codeAttempts" + 1,
          "consumedAt" = CASE
            WHEN "codeAttempts" + 1 >= ${maxAttempts} THEN ${now}
            ELSE "consumedAt"
          END,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}
        AND "consumedAt" IS NULL
        AND "verifiedAt" IS NULL
        AND "codeAttempts" < ${maxAttempts}
    `;
    return affected === 1;
  }

  async markCodeVerified(input: {
    id: string;
    ticketHash: string;
    ticketExpiresAt: Date;
    now: Date;
  }): Promise<boolean> {
    const affected = await this.client.$executeRaw`
      UPDATE "EmailChallenge"
      SET "codeVerifiedAt" = ${input.now},
          "verifiedAt" = ${input.now},
          "verifiedVia" = 'code',
          "ticketHash" = ${input.ticketHash},
          "ticketExpiresAt" = ${input.ticketExpiresAt},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.id}
        AND "consumedAt" IS NULL
        AND "verifiedAt" IS NULL
        AND "codeExpiresAt" > ${input.now}
    `;
    return affected === 1;
  }

  findToken(challengeId: string): Promise<EmailChallengeTokenRow | null> {
    return this.client.emailChallenge.findUnique({
      where: { id: challengeId },
      select: {
        email: true,
        type: true,
        tokenHash: true,
        tokenExpiresAt: true,
        tokenConsumedAt: true,
        verifiedAt: true,
        consumedAt: true,
      },
    });
  }

  async markTokenVerified(input: {
    id: string;
    tokenHash: string;
    ticketHash: string;
    ticketExpiresAt: Date;
    now: Date;
  }): Promise<boolean> {
    const affected = await this.client.$executeRaw`
      UPDATE "EmailChallenge"
      SET "tokenConsumedAt" = ${input.now},
          "verifiedAt" = ${input.now},
          "verifiedVia" = 'link',
          "ticketHash" = ${input.ticketHash},
          "ticketExpiresAt" = ${input.ticketExpiresAt},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.id}
        AND "consumedAt" IS NULL
        AND "verifiedAt" IS NULL
        AND "tokenHash" = ${input.tokenHash}
        AND "tokenConsumedAt" IS NULL
        AND "tokenExpiresAt" > ${input.now}
    `;
    return affected === 1;
  }

  findChallengeForTicket(
    challengeId: string
  ): Promise<ChallengeForTicketRow | null> {
    return this.client.emailChallenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        email: true,
        type: true,
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

  async completeChallenge(challengeId: string, now: Date): Promise<void> {
    await this.client.emailChallenge.updateMany({
      where: { id: challengeId },
      data: { consumedAt: now },
    });
  }

  transaction<T>(
    operation: (repository: AuthChallengeRepository) => Promise<T>
  ): Promise<T> {
    if (this.client !== this.rootClient) {
      return operation(this);
    }

    return this.rootClient.$transaction(
      (transaction) =>
        operation(
          new PrismaAuthChallengeRepository(transaction, this.rootClient)
        ),
      { isolationLevel: "Serializable" }
    );
  }
}

export const authChallengeRepository = new PrismaAuthChallengeRepository(
  prisma,
  prisma
);
