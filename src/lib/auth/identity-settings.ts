import "server-only";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveEmail } from "@/lib/auth/service";

/** Session is authoritative for ownership; re-read the account for legacy healing. */
export async function identitySettingsUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true } });
  if (!user) return null;
  if (user.email) {
    const resolution = await resolveEmail(user.email);
    if (resolution.kind !== "resolved" || resolution.userId !== user.id) return null;
  }
  return user;
}
