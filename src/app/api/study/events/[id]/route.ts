import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eventInput } from "@/lib/study/event-contracts";
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const removed = await prisma.studyEvent.deleteMany({ where: { id, userId: session.user.id } });
  return removed.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "日程不存在" }, { status: 404 });
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let parsed;
  try { parsed = eventInput.safeParse(await request.json()); } catch { return NextResponse.json({ error: "日程格式无效" }, { status: 400 }); }
  if (!parsed.success) return NextResponse.json({ error: "请确认日程时间" }, { status: 400 });
  const { id } = await context.params;
  const changed = await prisma.studyEvent.updateMany({ where: { id, userId: session.user.id, kind: { in: ["course", "busy"] } }, data: { ...parsed.data, start: new Date(parsed.data.start), end: new Date(parsed.data.end) } });
  return changed.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "日程不存在或无法修改" }, { status: 404 });
}
