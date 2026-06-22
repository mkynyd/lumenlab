/**
 * GET /api/user/profile-roles — 获取用户已保存的角色列表+可用角色目录
 * POST /api/user/profile-roles — 添加一个角色（通过 roleKey）
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const userId = session.user.id;

  const [profileRoles, availableRoles] = await Promise.all([
    prisma.userProfileRole.findMany({
      where: { userId },
      include: {
        role: {
          select: { key: true, label: true, description: true },
        },
      },
      orderBy: { isPrimary: "desc" },
    }),
    prisma.userRole.findMany({
      where: { isActive: true },
      select: { key: true, label: true, description: true },
      orderBy: { priority: "desc" },
    }),
  ]);

  return NextResponse.json({
    roles: profileRoles.map((pr) => ({
      id: pr.id,
      roleKey: pr.role.key,
      label: pr.role.label,
      description: pr.role.description,
      isPrimary: pr.isPrimary,
    })),
    availableRoles,
  });
}

const addRoleSchema = z.object({
  roleKey: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = addRoleSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "roleKey 不能为空" }, { status: 400 });
  }

  const role = await prisma.userRole.findUnique({
    where: { key: body.data.roleKey, isActive: true },
  });
  if (!role) {
    return NextResponse.json({ error: "角色不存在" }, { status: 404 });
  }

  // Check if already exists
  const existing = await prisma.userProfileRole.findUnique({
    where: { userId_roleId: { userId: session.user.id, roleId: role.id } },
  });
  if (existing) {
    return NextResponse.json({
      role: {
        id: existing.id,
        roleKey: role.key,
        label: role.label,
        description: role.description,
        isPrimary: existing.isPrimary,
      },
    });
  }

  // If this is the first role, make it primary
  const count = await prisma.userProfileRole.count({
    where: { userId: session.user.id },
  });

  const profileRole = await prisma.userProfileRole.create({
    data: {
      userId: session.user.id,
      roleId: role.id,
      isPrimary: count === 0,
      source: "manual",
    },
  });

  return NextResponse.json({
    role: {
      id: profileRole.id,
      roleKey: role.key,
      label: role.label,
      description: role.description,
      isPrimary: profileRole.isPrimary,
    },
  });
}
