import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { studyModelJson } from "@/lib/study/model-gateway";
const inputSchema = z.object({ message: z.string().trim().min(1).max(10000), notebookId: z.string().max(120).optional(), history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(10000) }).strict()).max(12) }).strict();
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  let input;
  try { input = inputSchema.parse(await request.json()); } catch { return NextResponse.json({ error: "问题格式无效" }, { status: 400 }); }
  const notebook = input.notebookId ? await prisma.mistakeNotebook.findFirst({ where: { id: input.notebookId, collection: { userId: session.user.id } }, include: { collection: true } }) : null;
  if (input.notebookId && !notebook) return NextResponse.json({ error: "错题本不存在" }, { status: 404 });
  try {
    return NextResponse.json(await studyModelJson({ userId: session.user.id, provider: "deepseek", schema: z.object({ reply: z.string().min(1).max(16000) }).strict(), prompt: JSON.stringify({ task: "回答用户的学习安排与题集范围问题，需要确认细节时用简短自然语言询问。返回reply。你没有写入工具，不能声称已新增、删除或修改任务/课程/题目，也不能生成未经核验的试题答案。指导用户通过页面操作或确认预览。", scope: notebook?.collection ?? null, history: input.history, message: input.message }) }));
  } catch { return NextResponse.json({ error: "助手暂时无法回答，请重试" }, { status: 422 }); }
}
