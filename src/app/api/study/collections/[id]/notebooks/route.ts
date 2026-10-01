import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "无效的 JSON" }, { status: 400 }); }
  const input = z.object({ name: z.string().trim().min(1).max(100) }).strict().safeParse(raw);
  if (!input.success) return NextResponse.json({ error: "请填写错题本名称" }, { status: 400 });
  const collection = await prisma.studyCollection.findFirst({ where: { id, userId: session.user.id } });
  if (!collection) return NextResponse.json({ error: "题集不存在" }, { status: 404 });
  const notebook = await prisma.mistakeNotebook.create({ data: { collectionId: id, name: input.data.name } });
  return NextResponse.json({ notebook }, { status: 201 });
}
