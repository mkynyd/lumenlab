import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const paper = await prisma.bankPaper.findFirst({ where: { id, verified: true }, select: { title: true, sourceUrl: true, license: true } });
  if (!paper) return NextResponse.json({ error: "试卷不存在" }, { status: 404 });
  const after = new URL(request.url).searchParams.get("after");
  if (after && !(await prisma.bankQuestion.findFirst({ where: { id: after, paperId: id, verified: true }, select: { id: true } }))) return NextResponse.json({ error: "分页位置无效" }, { status: 400 });
  const questions = await prisma.bankQuestion.findMany({ where: { paperId: id, verified: true }, orderBy: { id: "asc" }, ...(after ? { cursor: { id: after }, skip: 1 } : {}), select: { id: true, ordinal: true, prompt: true, assets: true }, take: 101 });
  return NextResponse.json({ paper, questions: questions.slice(0, 100).map(question => ({ id: question.id, ordinal: question.ordinal, prompt: question.prompt, assets: Array.isArray(question.assets) ? question.assets.map((_, index) => `/api/study/bank/questions/${question.id}/assets/${index}`) : [] })), nextCursor: questions.length > 100 ? questions[99].id : null });
}
