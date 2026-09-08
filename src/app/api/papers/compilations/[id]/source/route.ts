import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createSignedDownloadUrl, readStoredObject, type StorageProvider } from "@/lib/storage/object-storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const compilation = await prisma.paperCompilation.findFirst({
    where: { id: (await context.params).id, documentVersion: { document: { userId: session.user.id } } },
    select: { sourceStorageProvider: true, sourceObjectKey: true },
  });
  if (!compilation?.sourceObjectKey || !compilation.sourceStorageProvider) return NextResponse.json({ error: "LaTeX Project 尚未生成" }, { status: 404 });
  if (compilation.sourceStorageProvider !== "local" && compilation.sourceStorageProvider !== "qiniu") return NextResponse.json({ error: "LaTeX Project 存储来源无效" }, { status: 422 });
  const provider = compilation.sourceStorageProvider as StorageProvider;
  if (provider === "qiniu") {
    return NextResponse.redirect(createSignedDownloadUrl({ provider, key: compilation.sourceObjectKey, filename: "paper-latex-project.zip", expiresInSeconds: 600 }));
  }
  const data = await readStoredObject({ provider, key: compilation.sourceObjectKey });
  return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": "application/zip", "Content-Disposition": "attachment; filename*=UTF-8''paper-latex-project.zip" } });
}
