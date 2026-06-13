import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createDocumentChunks } from "@/lib/rag/vector-store";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

// Allowed file types for text parsing
const TEXT_MIME_TYPES: Record<string, string> = {
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "application/json": "json",
  "text/javascript": "js",
  "text/typescript": "ts",
  "application/typescript": "ts",
  "text/jsx": "jsx",
  "text/tsx": "tsx",
};

const CODE_EXTENSIONS: Record<string, string> = {
  "txt": "text/plain",
  "md": "text/markdown",
  "csv": "text/csv",
  "json": "application/json",
  "ts": "text/typescript",
  "tsx": "text/tsx",
  "js": "text/javascript",
  "jsx": "text/jsx",
  "py": "text/x-python",
  "c": "text/x-c",
  "cpp": "text/x-c++",
  "h": "text/x-c",
  "java": "text/x-java",
  "sql": "text/x-sql",
  "html": "text/html",
  "css": "text/css",
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id: projectId } = await params;

  // Verify project ownership
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const files = await prisma.fileAsset.findMany({
    where: { projectId, userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      originalName: true,
      mimeType: true,
      size: true,
      status: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ files });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id: projectId } = await params;

  // Verify project ownership
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "请选择文件" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "文件大小超过 10MB 限制" },
        { status: 400 }
      );
    }

    const originalName = file.name;
    const ext = path.extname(originalName).toLowerCase().slice(1);

    // Validate extension
    if (!CODE_EXTENSIONS[ext] && ext !== "pdf" && !["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(ext)) {
      return NextResponse.json(
        { error: `不支持的文件类型: .${ext}` },
        { status: 400 }
      );
    }

    // Sanitize filename
    const safeName = `${crypto.randomUUID()}${path.extname(originalName)}`;
    const mimeType = CODE_EXTENSIONS[ext] || file.type || "application/octet-stream";

    // Ensure upload directory exists
    await mkdir(UPLOAD_DIR, { recursive: true });

    // Save file to disk
    const buffer = Buffer.from(await file.arrayBuffer());
    const storagePath = path.join(UPLOAD_DIR, safeName);
    await writeFile(storagePath, buffer);

    // Parse text content if possible
    let textContent: string | null = null;
    let status = "uploaded";

    if (CODE_EXTENSIONS[ext]) {
      try {
        textContent = buffer.toString("utf-8");
        status = "parsed";
      } catch {
        status = "uploaded";
      }
    } else {
      // PDF, images — not parsed in MVP
      textContent = null;
      status = "uploaded";
    }

    const fileAsset = await prisma.fileAsset.create({
      data: {
        userId: session.user.id,
        projectId,
        filename: safeName,
        originalName,
        mimeType,
        size: file.size,
        storagePath: safeName,
        textContent,
        status,
      },
    });

    // If text was parsed, create document chunks for RAG
    if (textContent && textContent.trim().length > 0) {
      createDocumentChunks({
        fileAssetId: fileAsset.id,
        projectId,
        userId: session.user.id,
        textContent,
        title: originalName,
      }).catch((err) => {
        console.error(`DocumentChunk creation failed for ${fileAsset.id}:`, err);
      });
    }

    return NextResponse.json(
      {
        file: {
          id: fileAsset.id,
          filename: fileAsset.filename,
          originalName: fileAsset.originalName,
          mimeType: fileAsset.mimeType,
          size: fileAsset.size,
          status: fileAsset.status,
          createdAt: fileAsset.createdAt,
        },
        note:
          status === "uploaded"
            ? "当前版本暂不解析图片/PDF 内容，仅保存文件"
            : undefined,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("File upload error:", err);
    return NextResponse.json(
      { error: "文件上传失败，请稍后重试" },
      { status: 500 }
    );
  }
}
