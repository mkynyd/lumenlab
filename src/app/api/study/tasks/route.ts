import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { taskSchema } from "@/lib/study/contracts";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const tasks = await prisma.studyTask.findMany({ where: { userId: session.user.id }, orderBy: [{ completed: "asc" }, { deadline: "asc" }] });
  return NextResponse.json({ tasks });
}
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "无效的 JSON" }, { status: 400 }); }
  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "请检查任务标题、截止日期和工作量" }, { status: 400 });
  const task = await prisma.studyTask.create({ data: { ...parsed.data, deadline: new Date(parsed.data.deadline), userId: session.user.id } });
  return NextResponse.json({ task }, { status: 201 });
}
