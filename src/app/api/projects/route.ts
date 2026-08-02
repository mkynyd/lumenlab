import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getDefaultQuickActions } from "@/lib/quick-actions";

const createProjectSchema = z.object({
  name: z.string().min(1, "项目名称不能为空").max(100),
  description: z.string().max(2000).optional(),
  type: z.enum(["experiment", "review", "coding", "general"]),
  defaultModel: z.string().optional(),
  thinkingEnabled: z.boolean().optional(),
  quickActions: z
    .array(
      z.object({
        title: z.string().min(1).max(6),
        prompt: z.string().min(1).max(200000),
      })
    )
    .max(12)
    .optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: { conversations: true, files: true },
      },
    },
  });

  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  // Verify the session user still exists in the database (e.g. after DB reset or seed refresh)
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });
  if (!dbUser) {
    return NextResponse.json(
      { error: "登录已失效，请重新登录", code: "SESSION_INVALID" },
      { status: 401 }
    );
  }

  let body: z.infer<typeof createProjectSchema>;
  try {
    const raw = await request.json();
    const parsed = createProjectSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "无效的 JSON 格式" }, { status: 400 });
  }

  const quickActions = [
    ...getDefaultQuickActions(body.type).map((action) => ({
      title: action.title,
      prompt: action.prompt,
      isSystem: true,
      sortOrder: action.sortOrder || 0,
    })),
    ...(body.quickActions || []).map((action, index) => ({
      title: action.title,
      prompt: action.prompt,
      isSystem: false,
      sortOrder: 100 + index,
    })),
  ];

  // 顶层 create 带嵌套 create + include 会让查询编译器把子写入并发派发到
  // 同一连接（pg 驱动适配器下已弃用），因此拆成事务内串行三步：
  // 建项目、批量建快捷指令、再读回组装响应。
  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        userId: session.user.id,
        name: body.name,
        description: body.description || null,
        type: body.type,
        defaultModel: body.defaultModel || "deepseek-v4-flash",
        thinkingEnabled: body.thinkingEnabled ?? true,
      },
    });
    if (quickActions.length > 0) {
      await tx.quickAction.createMany({
        data: quickActions.map((action) => ({
          ...action,
          projectId: created.id,
        })),
      });
    }
    return created;
  });

  const loaded = await prisma.project.findUniqueOrThrow({
    where: { id: project.id },
    include: {
      files: true,
      conversations: true,
      quickActions: {
        orderBy: [{ isSystem: "desc" }, { sortOrder: "asc" }],
      },
      _count: {
        select: { conversations: true, files: true },
      },
    },
  });

  return NextResponse.json({ project: loaded }, { status: 201 });
}
