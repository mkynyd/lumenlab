import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { uploadObjectBuffer } from "@/lib/storage/object-storage";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "figure";
}

function isUploadFile(value: unknown): value is File {
  return Boolean(value && typeof value === "object" && "name" in value && "size" in value && "arrayBuffer" in value && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id: workspaceId } = await params;
  const workspace = await prisma.paperWorkspace.findFirst({ where: { id: workspaceId, userId: session.user.id }, select: { id: true, projectId: true } });
  if (!workspace) return NextResponse.json({ error: "论文工作区不存在或无权访问" }, { status: 404 });
  const file = (await request.formData()).get("file");
  if (!isUploadFile(file) || !file.name) return NextResponse.json({ error: "请选择图片文件" }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "图片大小必须在 1B 到 20MB 之间" }, { status: 400 });
  const mimeType = typeof file.type === "string" ? file.type.toLowerCase() : "";
  if (!IMAGE_TYPES.has(mimeType)) return NextResponse.json({ error: "仅支持 PNG、JPEG、GIF、WebP 和 SVG 图片" }, { status: 400 });
  const fileId = crypto.randomUUID();
  const originalName = file.name.slice(0, 255);
  const filename = safeFileName(originalName);
  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await uploadObjectBuffer({ key: "papers/" + session.user.id + "/" + workspaceId + "/assets/" + fileId + "/" + filename, mimeType, buffer });
  const asset = await prisma.fileAsset.create({
    data: {
      id: fileId,
      userId: session.user.id,
      projectId: workspace.projectId,
      filename,
      originalName,
      mimeType,
      size: buffer.byteLength,
      storageProvider: stored.provider,
      storagePath: stored.key,
      status: "uploaded",
      category: "paper-asset",
      processingMetadata: { source: "paper-editor", workspaceId, uploadedAt: new Date().toISOString() },
    },
    select: { id: true, originalName: true, mimeType: true, size: true },
  });
  return NextResponse.json({ asset }, { status: 201 });
}
