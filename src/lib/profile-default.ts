import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

/**
 * 新用户默认 CredentialProfile：第一个 status=active 且含 active deepseek
 * 凭证的 profile（确定性排序，同注册码时代的行为等价）。
 * 无可用 profile 时返回 null，注册流程应拒绝注册（profile_unavailable）。
 */
export async function findDefaultCredentialProfile(
  client: DatabaseClient
): Promise<{ id: string } | null> {
  return client.credentialProfile.findFirst({
    where: {
      status: "active",
      credentials: {
        some: { provider: "deepseek", status: "active" },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
}
