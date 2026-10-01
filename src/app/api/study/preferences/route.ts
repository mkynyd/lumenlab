import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const preferences = await prisma.studyPreferences.findUnique({ where: { userId: session.user.id }, select: { termStart: true, periods: true, availability: true, timeZone: true } });
  return NextResponse.json({ preferences }, { headers: { "Cache-Control": "no-store" } });
}
