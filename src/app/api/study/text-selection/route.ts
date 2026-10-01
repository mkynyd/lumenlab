import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { textSelectionSchema, extractSelectedText } from "@/lib/study/text-selection";
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 5 * 1024 * 1024) return NextResponse.json({ error: "文本过大" }, { status: 413 });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "无效的选题数据" }, { status: 400 }); }
  const input = textSelectionSchema.safeParse(raw);
  if (!input.success) return NextResponse.json({ error: "请选择完整题目文本" }, { status: 400 });
  const notebook = await prisma.mistakeNotebook.findFirst({ where: { id: input.data.notebookId, collection: { userId: session.user.id } }, include: { collection: true } });
  if (!notebook) return NextResponse.json({ error: "错题本不存在" }, { status: 404 });
  const questions = extractSelectedText(input.data);
  // Text-only imports never fetch remote Markdown images or claim missing figures are present.
  if (questions.some(question => /!\[[^\]]*\]\(|<img\b/i.test(question.prompt))) return NextResponse.json({ error: "所选题目包含插图引用，请将插图和题目一起作为图片/PDF导入并绑定，避免遗漏" }, { status: 422 });
  const jobId = randomUUID(), itemIds = questions.map(() => randomUUID());
  await prisma.$transaction(async tx => {
    for (const [index, question] of questions.entries()) await tx.mistakeItem.create({ data: { id: itemIds[index], notebookId: notebook.id, sourceOrdinal: question.ordinal, prompt: question.prompt } });
    await tx.studyJob.create({ data: { id: jobId, userId: session.user.id, kind: "mistake-batch", payload: { items: itemIds, syllabus: notebook.collection.syllabus }, expiresAt: new Date(Date.now() + 7 * 86400000) } });
  });
  // Only selected exact substrings are persisted. Full source exists only within this request.
  return NextResponse.json({ jobId, itemIds }, { status: 201 });
}
