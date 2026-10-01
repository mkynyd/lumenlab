import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const job = await prisma.studyJob.findFirst({ where: { id, userId: session.user.id }, select: { id: true, status: true, progress: true, stage: true, error: true, attempts: true } });
  return job ? NextResponse.json({ job }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "任务不存在" }, { status: 404 });
}
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const result = await prisma.studyJob.updateMany({ where: { id, userId: session.user.id, kind: "mistake-batch", status: "failed", attempts: { lt: 3 }, expiresAt: { gt: new Date() } }, data: { status: "queued", error: null, stage: "等待重试" } });
  return result.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "任务无法重试" }, { status: 409 });
}
