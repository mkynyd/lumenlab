import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const url = new URL(request.url), subject = url.searchParams.get("subject")?.slice(0, 80), exam = url.searchParams.get("exam")?.slice(0, 100), year = Number(url.searchParams.get("year"));
  const stage = url.searchParams.get("stage")?.slice(0, 40);
  const papers = await prisma.bankPaper.findMany({ where: { verified: true, ...(stage ? { stage } : {}), ...(subject ? { subject: { contains: subject } } : {}), ...(exam ? { exam: { contains: exam } } : {}), ...(Number.isInteger(year) && year > 1900 ? { year } : {}) }, orderBy: [{ year: "desc" }, { title: "asc" }], take: 200, select: { id: true, title: true, stage: true, subject: true, exam: true, year: true, sourceUrl: true, license: true, _count: { select: { questions: { where: { verified: true } } } } } });
  return NextResponse.json({ papers });
}
