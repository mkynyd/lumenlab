import "server-only";
import { deleteStoredObject, type StoredObjectRef } from "@/lib/storage/object-storage";

export function temporaryAssetKey(userId: string, jobId: string, page: number): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(userId) || !/^[A-Za-z0-9_-]{1,120}$/.test(jobId) || !Number.isInteger(page) || page < 0) throw new Error("临时素材标识无效");
  return `study/temporary/${userId}/${jobId}/${page}.png`;
}
export function selectedAssetKey(userId: string, itemId: string, region: number): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(userId) || !/^[A-Za-z0-9_-]{1,120}$/.test(itemId) || !Number.isInteger(region) || region < 0) throw new Error("错题素材标识无效");
  return `study/selected/${userId}/${itemId}/${region}.png`;
}
export async function purgeTemporaryAssets(userId: string, jobId: string, refs: StoredObjectRef[]): Promise<void> {
  const prefix = temporaryAssetKey(userId, jobId, 0).replace(/0\.png$/, "");
  if (refs.some(ref => !ref.key.startsWith(prefix) || !/^\d+\.png$/.test(ref.key.slice(prefix.length)))) throw new Error("拒绝清理不属于本次导入的素材");
  // Keep the database manifest until all deletions succeed so cleanup can retry.
  const results = await Promise.allSettled(refs.map(deleteStoredObject));
  if (results.some(result => result.status === "rejected")) throw new Error("临时素材清理失败，后台将重试");
}
