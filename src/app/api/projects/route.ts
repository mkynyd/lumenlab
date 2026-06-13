import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

const createProjectSchema = z.object({
  name: z.string().min(1, "项目名称不能为空").max(100),
  description: z.string().max(2000).optional(),
  type: z.enum(["experiment", "review", "coding", "general"]),
  defaultModel: z.string().optional(),
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
    },
  });

  return NextResponse.json({ project }, { status: 201 });
}
