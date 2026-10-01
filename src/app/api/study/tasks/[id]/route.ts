import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "无效的 JSON" }, { status: 400 }); }
  const parsed = z.object({ completed: z.boolean() }).strict().safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "无效的完成状态" }, { status: 400 });
  const result = await prisma.studyTask.updateMany({ where: { id, userId: session.user.id }, data: parsed.data });
  return result.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "任务不存在" }, { status: 404 });
}
