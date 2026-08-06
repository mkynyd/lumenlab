import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type {
  PasswordResetRepository,
  PasswordResetTokenRow,
} from "@/lib/password-reset";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

class PrismaPasswordResetRepository implements PasswordResetRepository {
  constructor(
    private readonly client: DatabaseClient,
    private readonly rootClient: PrismaClient
  ) {}

  findResetToken(challengeId: string): Promise<PasswordResetTokenRow | null> {
    return this.client.emailChallenge.findUnique({
      where: { id: challengeId },
      select: {
        email: true,
        tokenHash: true,
        tokenExpiresAt: true,
        tokenConsumedAt: true,
        consumedAt: true,
      },
    });
  }

  async claimResetToken(input: {
    challengeId: string;
    tokenHash: string;
    now: Date;
  }): Promise<boolean> {
    const affected = await this.client.$executeRaw`
      UPDATE "EmailChallenge"
      SET "tokenConsumedAt" = ${input.now},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.challengeId}
        AND "type" = 'reset'
        AND "tokenHash" = ${input.tokenHash}
        AND "tokenConsumedAt" IS NULL
        AND "tokenExpiresAt" > ${input.now}
        AND "consumedAt" IS NULL
    `;
    return affected === 1;
  }

  findUserByEmail(email: string) {
    return this.client.user.findUnique({
      where: { email },
      select: { id: true },
    });
  }

  async updatePassword(
    userId: string,
    passwordHash: string,
    changedAt: Date
  ): Promise<void> {
    await this.client.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: changedAt },
    });
  }

  transaction<T>(
    operation: (repository: PasswordResetRepository) => Promise<T>
  ): Promise<T> {
    if (this.client !== this.rootClient) {
      return operation(this);
    }

    return this.rootClient.$transaction(
      (transaction) =>
        operation(
          new PrismaPasswordResetRepository(transaction, this.rootClient)
        ),
      { isolationLevel: "Serializable" }
    );
  }
}

export const passwordResetRepository = new PrismaPasswordResetRepository(
  prisma,
  prisma
);
