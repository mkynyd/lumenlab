import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readStoredObject, type StorageProvider } from "@/lib/storage/object-storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const compilation = await prisma.paperCompilation.findFirst({ where: { id: (await context.params).id, documentVersion: { document: { userId: session.user.id } } }, select: { status: true, pdfStorageProvider: true, pdfObjectKey: true } });
  if (!compilation?.pdfObjectKey || !compilation.pdfStorageProvider) return NextResponse.json({ error: "PDF 尚未生成" }, { status: 404 });
  const provider = compilation.pdfStorageProvider as StorageProvider;
  // PDF.js fetches this same-origin URL. A storage redirect would be blocked by
  // connect-src 'self', so read the private object on the server for both providers.
  const data = await readStoredObject({ provider, key: compilation.pdfObjectKey });
  return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename*=UTF-8''paper.pdf", "Cache-Control": "private, no-store" } });
}
