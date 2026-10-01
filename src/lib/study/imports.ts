import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { uploadObjectBuffer, activeStorageProvider, type StoredObjectRef } from "@/lib/storage/object-storage";
import { temporaryAssetKey, purgeTemporaryAssets } from "./asset-lifecycle";
import { renderStudyDocument } from "./render-document";
export async function createStudyImport(userId: string, files: File[]) {
  if (!files.length || files.length > 80 || files.some(file => !file.size) || files.reduce((size, file) => size + file.size, 0) > 30 * 1024 * 1024) throw new Error("单个文档需在30MB以内");
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const pages: StoredObjectRef[] = [];
  const provider = activeStorageProvider();
  // The row precedes object writes so interrupted uploads remain discoverable.
  await prisma.studyJob.create({ data: { id, userId, kind: "question-import", status: "rendering", stage: "生成扫描预览", payload: { pages: [] }, expiresAt } });
  try {
    const rendered: Buffer[] = [];
    let bytes = 0;
    for (const file of files) {
      const pages = await renderStudyDocument(Buffer.from(await file.arrayBuffer()), file.name, file.type);
      for (const page of pages) {
        bytes += page.length;
        if (rendered.length >= 80 || bytes > 150 * 1024 * 1024) throw new Error("一次最多80页和150MB预览图，请分批上传；未截断文件");
        rendered.push(page);
      }
    }
    for (let page = 0; page < rendered.length; page++) {
      const key = temporaryAssetKey(userId, id, page);
      // Record deterministic keys before upload, including failures after remote acceptance.
      pages.push({ provider, key });
      await prisma.studyJob.update({ where: { id }, data: { temporaryKeys: pages.map(ref => ref.key), payload: { pages: pages.map(ref => ({ provider: ref.provider, key: ref.key })) } } });
      await uploadObjectBuffer({ key, mimeType: "image/png", buffer: rendered[page] });
      await prisma.studyJob.update({ where: { id }, data: { payload: { pages: pages.map(ref => ({ provider: ref.provider, key: ref.key })) }, progress: Math.round((page + 1) / rendered.length * 100) } });
    }
    await prisma.studyJob.update({ where: { id }, data: { status: "selecting", stage: "请选择错题", progress: 100 } });
    return { id, expiresAt: expiresAt.toISOString(), pageCount: pages.length };
  } catch (error) {
    // The periodic cleanup additionally recovers rows interrupted between writes.
    try { await purgeTemporaryAssets(userId, id, pages); } catch { /* Keep keys for compensation. */ }
    await prisma.studyJob.update({ where: { id }, data: { status: "failed", stage: "导入失败", error: "文档预览失败，请重试", expiresAt: new Date() } });
    throw error;
  }
}
