import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const notebook = await prisma.mistakeNotebook.findFirst({ where: { id, collection: { userId: session.user.id } }, select: { id: true } });
  if (!notebook) return NextResponse.json({ error: "错题本不存在" }, { status: 404 });
  const items = await prisma.mistakeItem.findMany({ where: { notebookId: id }, orderBy: { createdAt: "desc" }, select: { id: true, prompt: true, status: true, topics: true, error: true, sourceOrdinal: true } });
  return NextResponse.json({ items });
}
