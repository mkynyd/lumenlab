import "server-only";
import { prisma } from "@/lib/db";
import { purgeTemporaryAssets } from "./asset-lifecycle";
import { purgeStagedAssets } from "./asset-staging";
import { pageManifestSchema } from "./contracts";

export async function cleanupExpiredStudyImports(now = new Date()) {
  const jobs = await prisma.studyJob.findMany({ where: { kind: "question-import", expiresAt: { lte: now }, temporaryKeys: { isEmpty: false } }, take: 50, orderBy: { expiresAt: "asc" } });
  let cleaned = 0;
  for (const job of jobs) {
    const parsed = pageManifestSchema.safeParse(job.payload);
    if (!parsed.success) continue;
    const claim = await prisma.studyJob.updateMany({ where: { id: job.id, expiresAt: { lte: now } }, data: { status: "cleaning" } });
    if (!claim.count) continue;
    try {
      await purgeTemporaryAssets(job.userId, job.id, parsed.data.pages);
      await prisma.studyJob.updateMany({ where: { id: job.id, expiresAt: { lte: now } }, data: { temporaryKeys: [], payload: { pages: [] }, status: "expired", stage: "临时原件已清除" } });
      cleaned++;
    } catch { /* Retain manifest and retry on the next sweep. */ }
  }
  const staged = await prisma.studyJob.findMany({ where: { kind: "asset-staging", status: { in: ["staging", "cleaning"] }, expiresAt: { lte: now } }, take: 50 });
  for (const job of staged) {
    const claimed = await prisma.studyJob.updateMany({ where: { id: job.id, status: { in: ["staging", "cleaning"] }, expiresAt: { lte: now } }, data: { status: "cleaning" } });
    if (!claimed.count) continue;
    try {
      await purgeStagedAssets(job.userId, job.payload);
      await prisma.studyJob.update({ where: { id: job.id }, data: { status: "cleaned", payload: {} } });
      cleaned++;
    } catch { /* Keep the scoped manifest until every orphan has been removed. */ }
  }
  return cleaned;
}
const globalCleanup = globalThis as typeof globalThis & { studyCleanupTimer?: ReturnType<typeof setInterval> };
export function startStudyImportCleanup() {
  if (globalCleanup.studyCleanupTimer) return;
  const sweep = () => { void cleanupExpiredStudyImports().catch(() => {}); };
  sweep();
  globalCleanup.studyCleanupTimer = setInterval(sweep, 60000);
  globalCleanup.studyCleanupTimer.unref();
}
