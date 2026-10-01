import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readStoredObject } from "@/lib/storage/object-storage";
import { runWebSearch } from "@/lib/tools/web/search-engine";
import { solutionSchema } from "./contracts";
import { studyModelJson, solveSelectedQuestion } from "./model-gateway";
const payloadSchema = z.object({ items: z.array(z.string()).min(1).max(100), syllabus: z.string() });
const assetSchema = z.array(z.object({ provider: z.enum(["local", "qiniu"]), key: z.string(), role: z.string(), page: z.number() })).max(32);
const ocrSchema = z.object({ markdown: z.string().min(1).max(200000), complete: z.boolean(), missing: z.array(z.string()).max(30) }).strict();
const globalWorker = globalThis as typeof globalThis & { studyWorker?: ReturnType<typeof setInterval>; studyWorkerBusy?: boolean };

export async function processStudyJob() {
  const now = new Date();
  await prisma.studyJob.updateMany({ where: { kind: "mistake-batch", status: "processing", attempts: { gte: 3 }, leaseUntil: { lt: now } }, data: { status: "failed", stage: "处理重试次数已用尽", error: "处理多次中断，请检查题目后重新收录", leaseOwner: null, leaseUntil: null } });
  const candidate = await prisma.studyJob.findFirst({ where: { kind: "mistake-batch", expiresAt: { gt: now }, attempts: { lt: 3 }, OR: [{ status: "queued" }, { status: "processing", leaseUntil: { lt: now } }] }, orderBy: { createdAt: "asc" } });
  if (!candidate) return;
  const owner = randomUUID();
  const claimed = await prisma.studyJob.updateMany({ where: { id: candidate.id, status: candidate.status, leaseOwner: candidate.leaseOwner, leaseUntil: candidate.leaseUntil }, data: { status: "processing", leaseOwner: owner, leaseUntil: new Date(Date.now() + 180000), attempts: { increment: 1 } } });
  if (!claimed.count) return;
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    void prisma.studyJob.updateMany({ where: { id: candidate.id, leaseOwner: owner, status: "processing" }, data: { leaseUntil: new Date(Date.now() + 180000) } }).then(result => { if (!result.count) controller.abort(); }).catch(() => controller.abort());
  }, 30000);
  heartbeat.unref();
  const progress = async (stage: string, percent: number) => {
    if (controller.signal.aborted) throw new Error("任务租约已失效");
    const result = await prisma.studyJob.updateMany({ where: { id: candidate.id, leaseOwner: owner, status: "processing" }, data: { stage, progress: percent } });
    if (!result.count) { controller.abort(); throw new Error("任务租约已失效"); }
  };
  try {
    const payload = payloadSchema.parse(candidate.payload);
    let completed = 0;
    for (const id of payload.items) {
      const item = await prisma.mistakeItem.findFirst({ where: { id, notebook: { collection: { userId: candidate.userId } } } });
      if (!item) throw new Error("错题不存在");
      if (item.status === "ready" || item.status === "needs_review") { completed++; continue; }
      const assets = assetSchema.parse(item.assets);
      if (assets.some(asset => !asset.key.startsWith(`study/selected/${candidate.userId}/${item.id}/`))) throw new Error("素材归属无效");
      const images = [];
      let imageBytes = 0;
      for (const [index, asset] of assets.entries()) {
        const data = await readStoredObject(asset);
        imageBytes += data.length;
        if (imageBytes > 20 * 1024 * 1024) throw new Error("题目图像过大，请缩小选框或分批导入");
        images.push({ name: `区域${index + 1}-${asset.role}.png`, mimeType: "image/png", size: data.length, data });
      }
      const base = Math.floor(completed / payload.items.length * 100);
      await progress(`第${completed + 1}/${payload.items.length}题：识别题干、公式与关联插图`, base);
      const ocr = item.prompt.trim() ? { markdown: item.prompt, complete: true, missing: [] } : await studyModelJson({ userId: candidate.userId, provider: "bailian", images, signal: controller.signal, schema: ocrSchema,
        prompt: "依次读取题干、续题、插图和共享材料。逐字转为markdown，公式使用$内联公式$或$$块公式$$。保留全部选项、长文、表格、数字、图中标签和关系，不概括或省略，不补写被遮挡内容。用图注关联插图。只返回markdown、complete、missing；无法完整读取则complete=false，并列出缺失。" });
      await progress("检查题目完整性", Math.min(99, base + 1));
      if (!ocr.complete || ocr.missing.length) {
        await prisma.$transaction(async tx => {
          const fenced = await tx.studyJob.updateMany({ where: { id: candidate.id, leaseOwner: owner, status: "processing" }, data: { stage: "题目需校对" } });
          if (!fenced.count) throw new Error("任务租约已失效");
          await tx.mistakeItem.update({ where: { id }, data: { prompt: ocr.markdown, status: "needs_review", error: "题目识别不完整，请检查选框", verification: { missing: ocr.missing } } });
        });
        completed++; continue;
      }
      await prisma.$transaction(async tx => {
        const fenced = await tx.studyJob.updateMany({ where: { id: candidate.id, leaseOwner: owner, status: "processing" }, data: { stage: "题目识别完成" } });
        if (!fenced.count) throw new Error("任务租约已失效");
        await tx.mistakeItem.update({ where: { id }, data: { prompt: ocr.markdown, status: "processing", error: null } });
      });
      const hash = createHash("sha256").update(ocr.markdown.normalize("NFC").replace(/\s+/g, " ").trim()).digest("hex");
      const matches = assets.length === 0 ? await prisma.bankQuestion.findMany({ where: { contentHash: hash, verified: true, paper: { verified: true } }, take: 2 }) : [];
      const bank = matches.length === 1 && Array.isArray(matches[0].assets) && matches[0].assets.length === 0 ? matches[0] : null;
      const bankSolution = bank ? solutionSchema.safeParse(bank.solution) : null;
      if (bank && bankSolution?.success) {
        await prisma.$transaction(async tx => {
          const fenced = await tx.studyJob.updateMany({ where: { id: candidate.id, leaseOwner: owner, status: "processing" }, data: { stage: "采用已核验题库答案" } });
          if (!fenced.count) throw new Error("任务租约已失效");
          await tx.mistakeItem.update({ where: { id }, data: { prompt: ocr.markdown, bankQuestionId: bank.id, solution: bankSolution.data, topics: bankSolution.data.topics, status: "ready", verification: { source: "verified-bank", paperId: bank.paperId } } });
        });
        completed++; continue;
      }
      await progress("检索答案来源", Math.min(99, base + 2));
      const sources = await runWebSearch(ocr.markdown.slice(0, 1000), { maxResults: 5 });
      const result = await solveSelectedQuestion({ userId: candidate.userId, question: ocr.markdown, syllabus: payload.syllabus, sources, images, signal: controller.signal,
        progress: stage => progress(`第${completed + 1}/${payload.items.length}题：${stage}`, Math.min(99, base + 3)) });
      // Fence the final item write with the same durable lease as the stage updates.
      await prisma.$transaction(async tx => {
        const fenced = await tx.studyJob.updateMany({ where: { id: candidate.id, leaseOwner: owner, status: "processing" }, data: { progress: Math.floor((completed + 1) / payload.items.length * 100) } });
        if (!fenced.count) throw new Error("任务租约已失效");
        await tx.mistakeItem.update({ where: { id }, data: { prompt: ocr.markdown, solution: result.solution ?? undefined, verification: { verdict: result.verdict, candidates: result.candidates, sources: { query: sources.query, summary: sources.summary, sources: sources.sources.map(source => ({ url: source.url, title: source.title ?? "" })) } }, topics: result.solution?.topics ?? [], status: result.solution ? "ready" : "needs_review", error: result.solution ? null : "答案核验未通过" } });
      });
      completed++;
    }
    await prisma.studyJob.updateMany({ where: { id: candidate.id, leaseOwner: owner, status: "processing" }, data: { status: "completed", progress: 100, stage: "处理完成", leaseOwner: null, leaseUntil: null } });
  } catch {
    if (!controller.signal.aborted) await prisma.studyJob.updateMany({ where: { id: candidate.id, leaseOwner: owner, status: "processing" }, data: { status: "failed", error: "错题处理未完成，可重新提交处理", stage: "处理失败", leaseOwner: null, leaseUntil: null } });
  } finally { clearInterval(heartbeat); }
}
export function startStudyWorker() {
  if (globalWorker.studyWorker) return;
  const tick = () => {
    if (globalWorker.studyWorkerBusy) return;
    globalWorker.studyWorkerBusy = true;
    void processStudyJob().catch(() => {}).finally(() => { globalWorker.studyWorkerBusy = false; });
  };
  globalWorker.studyWorker = setInterval(tick, 5000);
  globalWorker.studyWorker.unref(); tick();
}
