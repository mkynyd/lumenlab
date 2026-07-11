import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const batchCreateSchema = z.object({
  actions: z
    .array(
      z.object({
        title: z.string().min(1).max(6),
        prompt: z.string().min(1).max(200000),
      })
    )
    .max(12),
});

async function assertProject(userId: string, projectId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id: projectId } = await params;
  const project = await assertProject(session.user.id, projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的 JSON 格式" }, { status: 400 });
  }

  const parsed = batchCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { actions } = parsed.data;
  if (actions.length === 0) {
    return NextResponse.json({ count: 0 }, { status: 201 });
  }

  const maxSort = await prisma.quickAction.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });

  const baseSortOrder = (maxSort._max.sortOrder ?? 0) + 1;
  await prisma.quickAction.createMany({
    data: actions.map((action, index) => ({
      projectId,
      title: action.title,
      prompt: action.prompt,
      isSystem: false,
      sortOrder: baseSortOrder + index,
    })),
  });

  return NextResponse.json({ count: actions.length }, { status: 201 });
}
