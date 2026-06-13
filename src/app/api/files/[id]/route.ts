import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteChunksByFileAsset } from "@/lib/rag/vector-store";
import { unlink } from "fs/promises";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function GET(
  request: Request,
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

  return NextResponse.json({ file });
}

export async function DELETE(
  request: Request,
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

  // Delete related chunks
  await deleteChunksByFileAsset(file.id, session.user.id);

  // Delete physical file
  try {
    const filePath = path.join(UPLOAD_DIR, file.storagePath);
    await unlink(filePath);
  } catch {
    // File might not exist on disk, that's ok
  }

  await prisma.fileAsset.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
