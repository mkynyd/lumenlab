import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const events = await prisma.studyEvent.findMany({ where: { userId: session.user.id }, orderBy: { start: "asc" }, take: 5000 });
  return NextResponse.json({ events });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { eventInput } = await import("@/lib/study/event-contracts");
  let parsed;
  try { parsed = eventInput.safeParse(await request.json()); } catch { return NextResponse.json({ error: "日程格式无效" }, { status: 400 }); }
  if (!parsed.success) return NextResponse.json({ error: "请确认日程标题、开始和结束时间" }, { status: 400 });
  const event = await prisma.studyEvent.create({ data: { ...parsed.data, userId: session.user.id, start: new Date(parsed.data.start), end: new Date(parsed.data.end), metadata: { source: "user-confirmed-school-or-busy" } } });
  return NextResponse.json({ event }, { status: 201 });
}
