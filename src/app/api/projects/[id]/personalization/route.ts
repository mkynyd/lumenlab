/**
 * POST /api/projects/[id]/personalization
 *
 * 保存项目级个性化设置：ProjectRole + QuickActions。
 * 用户身份分类结果写入 ProjectRole 表，选中的快捷任务写入 QuickAction 表。
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

const classificationSchema = z.object({
  roleKey: z.string().nullable(),
  mode: z.string(),
  domain: z.string(),
  confidence: z.number(),
  reason: z.string(),
});

const quickActionSchema = z.object({
  title: z.string().min(1).max(30),
  prompt: z.string().min(1).max(2000),
});

const requestSchema = z.object({
  classification: classificationSchema,
  quickActions: z.array(quickActionSchema).default([]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id: projectId } = await params;

  // Verify project ownership
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true, id: true },
  });
  if (!project || project.userId !== session.user.id) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "参数无效", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { classification, quickActions } = parsed.data;

  try {
    // Save or update ProjectRole
    if (classification.roleKey) {
      const role = await prisma.userRole.findUnique({
        where: { key: classification.roleKey, isActive: true },
      });

      if (role) {
        // Deactivate existing ProjectRoles for this project
        await prisma.projectRole.updateMany({
          where: { projectId, isActive: true },
          data: { isActive: false },
        });

        // Create new ProjectRole
        await prisma.projectRole.create({
          data: {
            projectId,
            roleId: role.id,
            mode: classification.mode,
            classification: classification as unknown as Record<string, unknown>,
          },
        });
      }
    }

    // Save selected quick actions (only if classification confidence >= 0.7)
    if (quickActions.length > 0 && classification.confidence >= 0.7) {
      // Remove existing system quick actions for this project
      await prisma.quickAction.deleteMany({
        where: { projectId, isSystem: true },
      });

      // Create new system quick actions
      await prisma.quickAction.createMany({
        data: quickActions.map((action, index) => ({
          projectId,
          title: action.title,
          prompt: action.prompt,
          isSystem: true,
          sortOrder: index,
        })),
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Personalization save error:", error);
    return NextResponse.json(
      { error: "保存个性化设置失败" },
      { status: 500 }
    );
  }
}
