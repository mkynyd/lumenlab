import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readStoredObject, uploadObjectBuffer } from "@/lib/storage/object-storage";
import { selectedAssetKey } from "@/lib/study/asset-lifecycle";
import type { Prisma } from "@/generated/prisma/client";
import { beginAssetStaging } from "@/lib/study/asset-staging";
import { solutionSchema } from "@/lib/study/contracts";
const inputSchema = z.object({ notebookId: z.string().min(1).max(120), questionIds: z.array(z.string().min(1).max(120)).min(1).max(100) }).strict().refine(input => new Set(input.questionIds).size === input.questionIds.length);
const assetsSchema = z.array(z.object({ provider: z.enum(["local", "qiniu"]), key: z.string() })).max(32);
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const userId = session.user.id;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "无效的选题数据" }, { status: 400 }); }
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "请至少选择一道题目" }, { status: 400 });
  const notebook = await prisma.mistakeNotebook.findFirst({ where: { id: parsed.data.notebookId, collection: { userId } }, include: { collection: true } });
  if (!notebook) return NextResponse.json({ error: "错题本不存在" }, { status: 404 });
  const questions = await prisma.bankQuestion.findMany({ where: { id: { in: parsed.data.questionIds }, verified: true, paper: { verified: true } } });
  if (questions.length !== parsed.data.questionIds.length) return NextResponse.json({ error: "选中的题目不存在或未核验" }, { status: 404 });
  const staging = await beginAssetStaging(userId);
  try {
    const items: (Prisma.MistakeItemUncheckedCreateInput & { id: string })[] = [];
    for (const question of questions) {
      const id = randomUUID(), assets = [];
      const refs = assetsSchema.parse(question.assets);
      for (const [index, ref] of refs.entries()) {
        if (!ref.key.startsWith(`study/bank/${question.paperId}/${question.id}/`)) throw new Error("题库素材无效");
        const key = selectedAssetKey(userId, id, index);
        await staging.reserve(id, key);
        const stored = await uploadObjectBuffer({ key, mimeType: "image/png", buffer: await readStoredObject(ref) });
        assets.push({ provider: stored.provider, key: stored.key, role: "illustration", page: 0 });
      }
      const solution = solutionSchema.safeParse(question.solution);
      items.push({ id, notebookId: notebook.id, bankQuestionId: question.id, sourceOrdinal: question.ordinal, prompt: question.prompt, assets, status: solution.success ? "ready" : "queued", ...(solution.success ? { solution: solution.data, topics: solution.data.topics, verification: { source: "verified-bank", paperId: question.paperId } } : {}) });
    }
    const jobId = randomUUID(), pending = items.filter(item => item.status === "queued");
    await prisma.$transaction(async tx => {
      const claimed = await tx.studyJob.updateMany({ where: { id: staging.id, status: "staging" }, data: { status: "committed", payload: {} } });
      if (!claimed.count) throw new Error("素材保存已过期");
      for (const item of items) await tx.mistakeItem.create({ data: item });
      if (pending.length) await tx.studyJob.create({ data: { id: jobId, userId, kind: "mistake-batch", payload: { items: pending.map(item => item.id), syllabus: notebook.collection.syllabus }, expiresAt: new Date(Date.now() + 7 * 86400000) } });
    });
    return NextResponse.json({ itemIds: items.map(item => item.id), jobId: pending.length ? jobId : null }, { status: 201 });
  } catch {
    await staging.abandon();
    return NextResponse.json({ error: "题库选题保存失败，请重试" }, { status: 422 });
  }
}
