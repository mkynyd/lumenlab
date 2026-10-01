import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { activeStorageProvider, deleteStoredObject, type StoredObjectRef } from "@/lib/storage/object-storage";
import { z } from "zod";

export const stagingManifest = z.object({ assets: z.array(z.object({ itemId: z.string(), provider: z.enum(["local", "qiniu"]), key: z.string() }).strict()).max(3200) }).strict();
export async function beginAssetStaging(userId: string) {
  const id = randomUUID();
  await prisma.studyJob.create({ data: { id, userId, kind: "asset-staging", status: "staging", payload: { assets: [] }, expiresAt: new Date(Date.now() + 30 * 60000) } });
  const assets: { itemId: string; provider: "local" | "qiniu"; key: string }[] = [];
  return {
    id,
    async reserve(itemId: string, key: string) {
      if (!key.startsWith(`study/selected/${userId}/${itemId}/`)) throw new Error("素材归属无效");
      const ref = { itemId, provider: activeStorageProvider(), key };
      assets.push(ref);
      const claim = await prisma.studyJob.updateMany({ where: { id, status: "staging" }, data: { payload: { assets }, expiresAt: new Date(Date.now() + 30 * 60000) } });
      if (!claim.count) throw new Error("素材保存已过期，请重试");
      return ref;
    },
    async abandon() {
      await prisma.studyJob.updateMany({ where: { id, status: "staging" }, data: { expiresAt: new Date() } });
    },
  };
}
export async function purgeStagedAssets(userId: string, raw: unknown) {
  const { assets } = stagingManifest.parse(raw);
  for (const ref of assets) {
    if (!ref.key.startsWith(`study/selected/${userId}/${ref.itemId}/`) || !/^\d+\.png$/.test(ref.key.split("/").at(-1) ?? "")) throw new Error("素材归属无效");
    // A committed item protects its selected crops even if an old staging row survives.
    if (await prisma.mistakeItem.findFirst({ where: { id: ref.itemId, notebook: { collection: { userId } } }, select: { id: true } })) continue;
    await deleteStoredObject(ref as StoredObjectRef);
  }
}
