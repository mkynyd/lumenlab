import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { pageManifestSchema } from "@/lib/study/contracts";
import { purgeTemporaryAssets } from "@/lib/study/asset-lifecycle";
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const job = await prisma.studyJob.findFirst({ where: { id, userId: session.user.id, kind: "question-import", status: "selecting" } });
  if (!job) return NextResponse.json({ error: "导入不存在或已提交" }, { status: 404 });
  const claimed = await prisma.studyJob.updateMany({ where: { id, userId: session.user.id, status: "selecting" }, data: { status: "cancelled", expiresAt: new Date() } });
  if (!claimed.count) return NextResponse.json({ error: "导入已提交" }, { status: 409 });
  const manifest = pageManifestSchema.safeParse(job.payload);
  if (manifest.success) {
    try {
      await purgeTemporaryAssets(session.user.id, id, manifest.data.pages);
      await prisma.studyJob.update({ where: { id }, data: { temporaryKeys: [], payload: { pages: [] }, stage: "导入已取消，原件已清除" } });
    } catch { return NextResponse.json({ ok: true, cleanupPending: true }); }
  }
  return NextResponse.json({ ok: true });
}
