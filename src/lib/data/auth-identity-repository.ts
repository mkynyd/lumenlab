/**
 * AuthIdentity 的 Prisma repository（只做数据库操作，规则在 `@/lib/auth/identity`）。
 *
 * `identities` 使用可注入的 `DatabaseClient`，因此注册事务可以直接传入
 * `Prisma.TransactionClient`，保证 User 与 email Identity 在同一事务内落库；
 * `users` 固定挂在根 client 上用于跨事务的 legacy 兼容查找与 self-heal。
 */

import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  EMAIL_IDENTITY,
  type AuthIdentityRepository,
  type AuthIdentityRow,
  type LegacyEmailUserRow,
} from "@/lib/auth/identity";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

const IDENTITY_SELECT = {
  id: true,
  userId: true,
  type: true,
  provider: true,
  providerAccountId: true,
  verifiedAt: true,
  verificationSource: true,
} as const;

/**
 * AuthIdentity 读写适配器。
 *
 * 接受 `Prisma.TransactionClient` 时所有写入都落在外层事务里，
 * 这是注册流程“User 与 email Identity 同事务”的前提。
 */
export function createAuthIdentityRepository(
  client: DatabaseClient
): AuthIdentityRepository {
  return {
    async findEmailIdentity(
      providerAccountId: string
    ): Promise<AuthIdentityRow | null> {
      return client.authIdentity.findUnique({
        where: {
          provider_providerAccountId: {
            provider: EMAIL_IDENTITY.provider,
            providerAccountId,
          },
        },
        select: IDENTITY_SELECT,
      });
    },

    async createEmailIdentity(input: {
      userId: string;
      providerAccountId: string;
      verifiedAt: Date | null;
      verificationSource: string;
    }): Promise<AuthIdentityRow | null> {
      try {
        return await client.authIdentity.create({
          data: {
            userId: input.userId,
            type: EMAIL_IDENTITY.type,
            provider: EMAIL_IDENTITY.provider,
            providerAccountId: input.providerAccountId,
            verifiedAt: input.verifiedAt,
            verificationSource: input.verificationSource,
          },
          select: IDENTITY_SELECT,
        });
      } catch (error) {
        // P2002：同一外部身份已被并发请求补写。返回 null 让领域层重新解析，
        // 不区分是 self-heal 竞争还是真正的账户冲突（后者由解析结果暴露）。
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    async getUserByNormalizedEmail(
      normalizedEmail: string
    ): Promise<LegacyEmailUserRow | null> {
      // Expand 兼容窗口：历史 User.email 可能带首尾空格或大小写差异。
      // 这里必须按 lower(btrim(email)) 比较（Prisma 的 mode:"insensitive" 只处理
      // 大小写，处理不了空格），与 migration 回填和 User_email_normalized_key
      // 使用完全相同的表达式，保证两条路径判定一致且走同一个索引。
      const rows = await client.$queryRaw<LegacyEmailUserRow[]>`
        SELECT "id", "email", "emailVerifiedAt", "emailVerificationSource"
          FROM "User"
         WHERE lower(btrim("email")) = ${normalizedEmail}
         LIMIT 1
      `;
      return rows[0] ?? null;
    },

    async findEmailIdentityByUserId(
      userId: string
    ): Promise<AuthIdentityRow | null> {
      return client.authIdentity.findUnique({
        where: {
          userId_type: { userId, type: EMAIL_IDENTITY.type },
        },
        select: IDENTITY_SELECT,
      });
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** 归一化 + 查重的便捷入口（避免 API route 直接拼 Prisma 查询） */
export const authIdentityRepository = createAuthIdentityRepository(prisma);
