import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";

export const getApiKeys = cache(async (userId: string) =>
  prisma.apiKey.findMany({
    where: { userId },
    select: { provider: true, keyPrefix: true, createdAt: true },
  })
);
