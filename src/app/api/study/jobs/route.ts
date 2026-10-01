import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const jobs = await prisma.studyJob.findMany({ where: { userId: session.user.id, kind: "mistake-batch", status: { in: ["queued", "processing", "failed"] } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, status: true, stage: true, progress: true, error: true, attempts: true } });
  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}
