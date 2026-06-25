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

  const project = await prisma.project.create({
    data: {
      userId: session.user.id,
      name: body.name,
      description: body.description || null,
      type: body.type,
      defaultModel: body.defaultModel || "deepseek-v4-pro",
      thinkingEnabled: body.thinkingEnabled ?? true,
      quickActions: {
        create: [
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
        ],
      },
    },
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

  return NextResponse.json({ project }, { status: 201 });
}
