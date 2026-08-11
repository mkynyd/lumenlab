import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}

/**
 * 返回当前登录的管理员用户（含邮箱），非管理员或未登录返回 null。
 * 邮箱以数据库为准（session 回调不透传 email）。
 */
export async function getAdminUser(): Promise<{ id: string; email: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true },
  });
  if (!user || !isAdminEmail(user.email)) return null;
  return user;
}
