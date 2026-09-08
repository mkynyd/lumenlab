import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { mapSyncTexToNodes } from "@/lib/paper/synctex";
import { readStoredObject, type StorageProvider } from "@/lib/storage/object-storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const compilation = await prisma.paperCompilation.findFirst({
    where: { id: (await context.params).id, documentVersion: { document: { userId: session.user.id } } },
    select: { syncTex: true, errorLog: true },
  });
  if (!compilation) return NextResponse.json({ error: "编译任务不存在" }, { status: 404 });
  const syncTex = compilation?.syncTex && typeof compilation.syncTex === "object" && !Array.isArray(compilation.syncTex)
    ? compilation.syncTex as { provider?: string; key?: string; format?: string }
    : null;
  if (!syncTex?.provider || !syncTex.key) return NextResponse.json({ error: "SyncTeX 尚未生成" }, { status: 404 });
  if (syncTex.provider !== "local" && syncTex.provider !== "qiniu") return NextResponse.json({ error: "SyncTeX 存储来源无效" }, { status: 422 });
  const data = await readStoredObject({ provider: syncTex.provider as StorageProvider, key: syncTex.key });
  const expanded = syncTex.format === "synctex.gz" ? gunzipSync(data) : data;
  if (expanded.byteLength > 20 * 1024 * 1024) return NextResponse.json({ error: "SyncTeX 映射过大" }, { status: 413 });
  const errorLog = compilation.errorLog && typeof compilation.errorLog === "object" && !Array.isArray(compilation.errorLog) ? compilation.errorLog as { nodeMap?: unknown } : null;
  const nodeMap = errorLog?.nodeMap && typeof errorLog.nodeMap === "object" && !Array.isArray(errorLog.nodeMap) ? errorLog.nodeMap as Record<string, { line: number; kind: string }> : {};
  return NextResponse.json(mapSyncTexToNodes({ text: expanded.toString("utf8"), nodeMap }));
}
