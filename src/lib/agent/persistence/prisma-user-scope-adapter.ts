import { prisma } from "@/lib/db";
import type { UserScopePersistence } from "./user-scope-persistence";

/** Loads the exact persisted permission set and fails closed for missing users. */
export class PrismaUserScopeAdapter implements UserScopePersistence {
  async load(userId: string): Promise<string[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { scopes: true },
    });
    return Array.isArray(user?.scopes) &&
      user.scopes.every((scope): scope is string => typeof scope === "string")
      ? [...user.scopes]
      : [];
  }
}
