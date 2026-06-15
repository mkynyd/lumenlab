import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { RegistrationRepository } from "@/lib/register-user";

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

  findCodeByDigest(digest: string) {
    return this.client.registrationCode.findUnique({
      where: { codeDigest: digest },
      select: {
        id: true,
        status: true,
        redemptionCount: true,
        maxRedemptions: true,
        expiresAt: true,
        credentialProfile: {
          select: {
            id: true,
            status: true,
            credentials: {
              select: { provider: true, status: true },
            },
          },
        },
      },
    });
  }

  async consumeCode(codeId: string, now: Date) {
    const affected = await this.client.$executeRaw`
      UPDATE "RegistrationCode"
      SET "redemptionCount" = "redemptionCount" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${codeId}
        AND "status" = 'active'
        AND "redemptionCount" < "maxRedemptions"
        AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
    `;
    return affected === 1;
  }

  createUser(input: {
    email: string;
    passwordHash: string;
    credentialProfileId: string;
  }) {
    return this.client.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        credentialProfileId: input.credentialProfileId,
      },
      select: { id: true, email: true, name: true },
    });
  }

  async createRedemption(input: { codeId: string; userId: string }) {
    await this.client.registrationRedemption.create({ data: input });
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

