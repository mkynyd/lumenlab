import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createSignedDownloadUrl, readStoredObject, type StorageProvider } from "@/lib/storage/object-storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const compilation = await prisma.paperCompilation.findFirst({ where: { id: (await context.params).id, documentVersion: { document: { userId: session.user.id } } }, select: { syncTex: true } });
  const syncTex = compilation?.syncTex && typeof compilation.syncTex === "object" && !Array.isArray(compilation.syncTex) ? compilation.syncTex as { provider?: string; key?: string; format?: string } : null;
  if (!syncTex?.provider || !syncTex.key) return NextResponse.json({ error: "SyncTeX 尚未生成" }, { status: 404 });
  const provider = syncTex.provider as StorageProvider;
  if (provider === "qiniu") return NextResponse.redirect(createSignedDownloadUrl({ provider, key: syncTex.key, filename: "main.synctex.gz", expiresInSeconds: 600 }));
  const data = await readStoredObject({ provider, key: syncTex.key });
  return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": "application/gzip", "Content-Disposition": "attachment; filename*=UTF-8''main.synctex.gz" } });
}
