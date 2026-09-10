import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { invalidatePasswordChangedAtCache } from "@/lib/password-version";
import { createAuthIdentityRepository } from "@/lib/data/auth-identity-repository";
import { resolveChallengeTarget } from "@/lib/auth-challenge";
import type {
  PasswordResetRepository,
  PasswordResetTokenRow,
} from "@/lib/password-reset";
import type { AuthIdentityRepository } from "@/lib/auth/identity";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

class PrismaPasswordResetRepository implements PasswordResetRepository {
  private readonly identities: AuthIdentityRepository;

  constructor(
    private readonly client: DatabaseClient,
    private readonly rootClient: PrismaClient
  ) {
    this.identities = createAuthIdentityRepository(client);
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

  async findResetToken(
    challengeId: string
  ): Promise<PasswordResetTokenRow | null> {
    const row = await this.client.emailChallenge.findUnique({
      where: { id: challengeId },
      select: {
        email: true,
        target: true,
        tokenHash: true,
        tokenExpiresAt: true,
        tokenConsumedAt: true,
        consumedAt: true,
      },
    });
    if (!row) return null;
    // Expand 兼容：旧 Release 写入的挑战只有 legacy `email` 列
    return {
      target: resolveChallengeTarget(row),
      tokenHash: row.tokenHash,
      tokenExpiresAt: row.tokenExpiresAt,
      tokenConsumedAt: row.tokenConsumedAt,
      consumedAt: row.consumedAt,
    };
  }

  async claimResetToken(input: {
    challengeId: string;
    tokenHash: string;
    now: Date;
  }): Promise<boolean> {
    // legacy `type = 'reset'` 条件保留：migration 窗口内旧 Release 创建的挑战
    // 只有 legacy 列（通用 purpose 为 null），必须继续能认出来。
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

  async updatePassword(
    userId: string,
    passwordHash: string,
    changedAt: Date
  ): Promise<void> {
    await this.client.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: changedAt },
    });
    // 所有写密码路径（邮件重设 / 已登录改密）统一在此失效 pwchg 缓存，
    // 避免旧会话因 60s 缓存残留继续有效
    await invalidatePasswordChangedAtCache(userId);
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
