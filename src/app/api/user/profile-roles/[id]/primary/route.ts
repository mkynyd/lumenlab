/**
 * POST /api/user/profile-roles/[id]/primary — 设置为主角色
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await params;

  const profileRole = await prisma.userProfileRole.findUnique({
    where: { id },
  });
  if (!profileRole || profileRole.userId !== session.user.id) {
    return NextResponse.json({ error: "角色不存在" }, { status: 404 });
  }

  // Unset all primary, set this one
  await prisma.$transaction([
    prisma.userProfileRole.updateMany({
      where: { userId: session.user.id, isPrimary: true },
      data: { isPrimary: false },
    }),
    prisma.userProfileRole.update({
      where: { id },
      data: { isPrimary: true },
    }),
  ]);

  return NextResponse.json({ success: true });
}
