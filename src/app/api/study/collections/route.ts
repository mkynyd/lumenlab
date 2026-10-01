import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { collectionSchema } from "@/lib/study/contracts";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const collections = await prisma.studyCollection.findMany({
    where: { userId: session.user.id }, orderBy: { updatedAt: "desc" },
    include: { notebooks: { include: { _count: { select: { items: true } } } } },
  });
  return NextResponse.json({ collections });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return NextResponse.json({ error: "无效的 JSON" }, { status: 400 }); }
  const parsed = collectionSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "请检查题集信息", details: parsed.error.flatten() }, { status: 400 });
  const { notebookName, ...data } = parsed.data;
  const collection = await prisma.$transaction(async tx => {
    const created = await tx.studyCollection.create({ data: { ...data, userId: session.user.id } });
    await tx.mistakeNotebook.create({ data: { collectionId: created.id, name: notebookName } });
    return tx.studyCollection.findUniqueOrThrow({ where: { id: created.id }, include: { notebooks: true } });
  });
  return NextResponse.json({ collection }, { status: 201 });
}
