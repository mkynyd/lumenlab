/**
 * DELETE /api/user/profile-roles/[id] — 删除一个角色
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function DELETE(
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

  await prisma.userProfileRole.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
