import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth/identifier";
import {
  resolveChallengeChannel,
  type ChallengeScope,
  type VerificationChannel,
  LEGACY_TYPE_BY_PURPOSE,
  resolveChallengePurpose,
  type AuthChallengeRepository,
  type ChallengeForTicketRow,
  type ChallengeRow,
  type ChallengeTokenRow,
  type VerificationPurpose,
} from "@/lib/auth-challenge";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

// 通用字段与 legacy 字段一并读出：旧 Release 在 migration 窗口内创建的挑战
// 只有 legacy 列，读取方通过 resolveChallenge* 兼容推导（Expand 阶段逻辑）。
const CHALLENGE_GENERIC_SELECT = {
  channel: true,
  target: true,
  purpose: true,
} as const;

class PrismaAuthChallengeRepository implements AuthChallengeRepository {
  constructor(
    private readonly client: DatabaseClient,
    private readonly rootClient: PrismaClient
  ) {}

  async invalidateActiveChallenges(
    email: string,
    purpose: VerificationPurpose,
    now: Date,
    scope: ChallengeScope = { channel: "email" }
  ): Promise<void> {
    await this.client.emailChallenge.updateMany({
      where: {
        consumedAt: null,
        ...activeChallengeWhere(email, purpose, scope),
      },
      data: { consumedAt: now },
    });
  }

  createChallenge(input: {
    purpose: VerificationPurpose;
    channel?: VerificationChannel;
    email: string;
    userId?: string;
    codeHash: string;
    codeExpiresAt: Date;
    tokenHash: string | null;
    tokenExpiresAt: Date | null;
  }) {
    const generic = { channel: input.channel ?? "email", target: input.email, purpose: input.purpose };
    return this.client.emailChallenge.create({
      data: {
        // SMS 的 legacy email 仅是 opaque target，不代表真实邮箱；User.email 不写手机号。
        type: generic.channel === "sms" ? `sms_${input.purpose}` : LEGACY_TYPE_BY_PURPOSE[input.purpose],
        email: generic.target,
        // 通用列（expand 新增，nullable）
        channel: generic.channel,
        target: generic.target,
        purpose: generic.purpose,
        userId: input.userId ?? null,
        codeHash: input.codeHash,
        codeExpiresAt: input.codeExpiresAt,
        tokenHash: input.tokenHash,
        tokenExpiresAt: input.tokenExpiresAt,
      },
      select: { id: true },
    });
  }

  async findActiveByEmail(
    email: string,
    purpose: VerificationPurpose,
    scope: ChallengeScope = { channel: "email" }
  ): Promise<ChallengeRow | null> {
    const row = await this.client.emailChallenge.findFirst({
      where: { consumedAt: null, ...activeChallengeWhere(email, purpose, scope) },
      orderBy: { createdAt: "desc" },
    });
    return row ? withGenericFields(row) : null;
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
        AND "codeAttempts" < 5
    `;
    return affected === 1;
  }

  async findToken(challengeId: string): Promise<ChallengeTokenRow | null> {
    const row = await this.client.emailChallenge.findUnique({
      where: { id: challengeId },
      select: {
        email: true,
        type: true,
        ...CHALLENGE_GENERIC_SELECT,
        tokenHash: true,
        tokenExpiresAt: true,
        tokenConsumedAt: true,
        verifiedAt: true,
        consumedAt: true,
      },
    });
    return row ? withGenericFields(row) : null;
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

  async findChallengeForTicket(
    challengeId: string
  ): Promise<ChallengeForTicketRow | null> {
    const row = await this.client.emailChallenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        email: true,
        type: true,
        ...CHALLENGE_GENERIC_SELECT,
        verifiedAt: true,
        verifiedVia: true,
        ticketHash: true,
        ticketExpiresAt: true,
        ticketConsumedAt: true,
        consumedAt: true,
      },
    });
    return row ? withGenericFields(row) : null;
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

/**
 * pending challenge 的定位条件：新版本按通用列（channel/target/purpose）匹配，
 * 同时按 legacy `email`/`type` 匹配，覆盖 migration 窗口内旧 Release 写入的、
 * 通用列为 null 的挑战。两个条件都只用于“同目标同用途”的挑战，不会误伤其他用途。
 */
/** Legacy method name retained; all core predicates use channel/target/purpose/owner. */
export function activeChallengeWhere(target: string, purpose: VerificationPurpose, scope: ChallengeScope = { channel: "email" }): Prisma.EmailChallengeWhereInput {
  const userId = scope.userId ?? null;
  const generic: Prisma.EmailChallengeWhereInput = { channel: scope.channel, target, purpose, userId };
  if (scope.channel !== "email" || purpose === "bind_identity") return generic;
  // Fallback ONLY for old writers whose generic columns are absent. Never let
  // legacy type override an explicit different purpose/channel/target.
  return { OR: [generic, {
    AND: [
      { OR: [{ channel: null }, { channel: "email" }] },
      { OR: [{ purpose: null }, { purpose }] },
      { OR: [{ target: null }, { target }] },
      { email: target, type: LEGACY_TYPE_BY_PURPOSE[purpose], userId },
    ],
  }] };
}

/**
 * Expand 兼容：通用列在旧 Release 写入的行上为 null，
 * 这里统一按 legacy `type`/`email` 无损推导，上层只读通用语义。
 */
function withGenericFields<
  T extends {
    email: string;
    type: string;
    channel: string | null;
    target: string | null;
    purpose: string | null;
  },
>(row: T): T {
  return {
    ...row,
    channel: resolveChallengeChannel(row),
    target: row.target ?? normalizeEmail(row.email),
    purpose: row.purpose ?? resolveChallengePurpose(row),
  };
}

export const authChallengeRepository = new PrismaAuthChallengeRepository(
  prisma,
  prisma
);
