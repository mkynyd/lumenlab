import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const item = await prisma.mistakeItem.findFirst({ where: { id, notebook: { collection: { userId: session.user.id } } } });
  if (!item) return NextResponse.json({ error: "错题不存在" }, { status: 404 });
  const count = Array.isArray(item.assets) ? item.assets.length : 0;
  return NextResponse.json({ item: { id: item.id, prompt: item.prompt, status: item.status, solution: item.solution, verification: item.verification, topics: item.topics, error: item.error, assets: Array.from({ length: count }, (_, index) => `/api/study/items/${item.id}/assets/${index}`) } }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const [{ z }, { randomUUID }, { Prisma }] = await Promise.all([import("zod"), import("node:crypto"), import("@/generated/prisma/client")]);
  let parsed;
  try { parsed = z.object({ prompt: z.string().trim().min(1).max(200000), confirmedComplete: z.literal(true) }).strict().safeParse(await request.json()); } catch { return NextResponse.json({ error: "题面格式无效" }, { status: 400 }); }
  if (!parsed.success) return NextResponse.json({ error: "请校对完整题面并确认" }, { status: 400 });
  const { id } = await context.params;
  const item = await prisma.mistakeItem.findFirst({ where: { id, notebook: { collection: { userId: session.user.id } } }, include: { notebook: { include: { collection: true } } } });
  if (!item) return NextResponse.json({ error: "错题不存在" }, { status: 404 });
  const jobId = randomUUID();
  try {
    await prisma.$transaction(async tx => {
      const changed = await tx.mistakeItem.updateMany({ where: { id, status: { in: ["ready", "needs_review", "failed"] } }, data: { prompt: parsed.data.prompt, status: "queued", solution: Prisma.JsonNull, verification: { source: "user-corrected-statement" }, topics: [], error: null, bankQuestionId: null } });
      if (!changed.count) throw new Error("题目正在处理中");
      await tx.studyJob.create({ data: { id: jobId, userId: session.user.id, kind: "mistake-batch", payload: { items: [id], syllabus: item.notebook.collection.syllabus }, expiresAt: new Date(Date.now() + 7 * 86400000) } });
    });
    return NextResponse.json({ jobId });
  } catch { return NextResponse.json({ error: "题目正在处理中，请完成后再校对" }, { status: 409 }); }
}
