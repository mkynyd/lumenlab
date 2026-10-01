import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { uploadObjectBuffer, readStoredObject } from "@/lib/storage/object-storage";
import { selectionSchema } from "./contracts";
import { pageManifestSchema } from "./contracts";
import { selectedAssetKey, purgeTemporaryAssets } from "./asset-lifecycle";

import { beginAssetStaging } from "./asset-staging";

export async function submitSelectedMistakes(userId: string, importId: string, raw: unknown) {
  const input = selectionSchema.parse(raw);
  const notebook = await prisma.mistakeNotebook.findFirst({ where: { id: input.notebookId, collection: { userId } }, include: { collection: true } });
  if (!notebook) throw new Error("错题本不存在");
  const original = await prisma.studyJob.findFirst({ where: { id: importId, userId, kind: "question-import", expiresAt: { gt: new Date() } } });
  if (!original || original.status !== "selecting") throw new Error("导入不存在、已提交或已过期");
  const manifest = pageManifestSchema.parse(original.payload);
  if (input.questions.some(q => q.regions.some(r => r.page >= manifest.pages.length))) throw new Error("题目引用了不存在的页码");
  const claimed = await prisma.studyJob.updateMany({ where: { id: importId, userId, status: "selecting" }, data: { status: "cropping", stage: "保存已选错题", expiresAt: new Date(Date.now() + 30 * 60000) } });
  if (!claimed.count) throw new Error("导入已提交");
  const jobId = randomUUID();
  const assets: { provider: "local" | "qiniu"; key: string; role: string; page: number }[] = [];
  const items: { id: string; sourceOrdinal: string | null; assets: typeof assets }[] = [];
  let committed = false;
  const staging = await beginAssetStaging(userId).catch(async error => {
    await prisma.studyJob.updateMany({ where: { id: importId, status: "cropping" }, data: { status: "selecting", stage: "保存失败，请重试" } });
    throw error;
  });
  try {
    for (const question of input.questions) {
      const id = randomUUID();
      const selected: typeof assets = [];
      for (let index = 0; index < question.regions.length; index++) {
        const region = question.regions[index];
        const alive = await prisma.studyJob.updateMany({ where: { id: importId, status: "cropping" }, data: { expiresAt: new Date(Date.now() + 30 * 60000) } });
        if (!alive.count) throw new Error("导入已过期");
        const ref = manifest.pages[region.page];
        if (!ref.key.startsWith(`study/temporary/${userId}/${importId}/`)) throw new Error("素材归属无效");
        const data = await readStoredObject(ref);
        const image = sharp(data, { limitInputPixels: 40000000 });
        const meta = await image.metadata();
        if (!meta.width || !meta.height) throw new Error("扫描页无效");
        const left = Math.floor(region.x * meta.width), top = Math.floor(region.y * meta.height);
        const width = Math.min(meta.width - left, Math.max(1, Math.ceil(region.width * meta.width)));
        const height = Math.min(meta.height - top, Math.max(1, Math.ceil(region.height * meta.height)));
        // Preserve diagram labels; grayscale only on explicit user request, no thresholding or generative redraw.
        const selectedImage = image.extract({ left, top, width, height });
        const crop = await (input.scanMode === "grayscale" ? selectedImage.grayscale() : selectedImage).normalize().png().toBuffer();
        const key = selectedAssetKey(userId, id, index);
        await staging.reserve(id, key);
        const stored = await uploadObjectBuffer({ key, mimeType: "image/png", buffer: crop });
        const asset = { provider: stored.provider, key: stored.key, role: region.role, page: region.page };
        selected.push(asset); assets.push(asset);
      }
      items.push({ id, sourceOrdinal: question.sourceOrdinal ?? null, assets: selected });
    }
    await prisma.$transaction(async tx => {
      const claimed = await tx.studyJob.updateMany({ where: { id: staging.id, status: "staging" }, data: { status: "committed", payload: {}, temporaryKeys: [] } });
      if (!claimed.count) throw new Error("素材保存已过期，请重试");
      const originalClaim = await tx.studyJob.updateMany({ where: { id: importId, status: "cropping", expiresAt: { gt: new Date() } }, data: { status: "submitted", stage: "错题已提交，清理临时原件", result: { jobId }, expiresAt: new Date() } });
      if (!originalClaim.count) throw new Error("导入已过期");
      for (const item of items) await tx.mistakeItem.create({ data: { id: item.id, notebookId: notebook.id, sourceOrdinal: item.sourceOrdinal, assets: item.assets } });
      await tx.studyJob.create({ data: { id: jobId, userId, kind: "mistake-batch", payload: { items: items.map(item => item.id), syllabus: notebook.collection.syllabus }, expiresAt: new Date(Date.now() + 7 * 86400000) } });
    });
    committed = true;
    try {
      await purgeTemporaryAssets(userId, importId, manifest.pages);
      await prisma.studyJob.update({ where: { id: importId }, data: { temporaryKeys: [], payload: { pages: [] }, stage: "完整原件已清除" } });
    } catch { /* Durable TTL compensation retains the manifest. */ }
    return { jobId, itemIds: items.map(item => item.id) };
  } catch (error) {
    if (!committed) {
      await staging.abandon();
      await prisma.studyJob.updateMany({ where: { id: importId, status: "cropping" }, data: { status: "selecting", stage: "保存失败，请重试" } });
    }
    throw error;
  }
}
