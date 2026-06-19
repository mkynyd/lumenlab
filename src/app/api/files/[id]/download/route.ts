import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createSignedDownloadUrl,
  readStoredObject,
  type StorageProvider,
} from "@/lib/storage/object-storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id } = await params;
  const file = await prisma.fileAsset.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!file) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  const provider = file.storageProvider as StorageProvider;
  if (provider === "qiniu") {
    const url = createSignedDownloadUrl({
      provider,
      key: file.storagePath,
      filename: file.originalName,
      expiresInSeconds: 600,
    });
    return NextResponse.json({ url });
  }

  const data = await readStoredObject({ provider, key: file.storagePath });
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        file.originalName
      )}`,
    },
  });
}
