import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import path from "path";
import crypto from "crypto";
import { startFileParseBatch } from "@/lib/files/parse-job";
import { uploadFileBuffer } from "@/lib/storage/object-storage";

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

const DOCUMENT_EXTENSIONS: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  wps: "application/vnd.ms-works",
  et: "application/vnd.ms-excel",
  dps: "application/vnd.ms-powerpoint",
  pages: "application/vnd.apple.pages",
  numbers: "application/vnd.apple.numbers",
  key: "application/vnd.apple.keynote",
};

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES_PER_REQUEST = 20;

function isUploadFile(value: unknown): value is File {
  return Boolean(
    value &&
      typeof value === "object" &&
      "name" in value &&
      typeof (value as { name?: unknown }).name === "string" &&
      "size" in value &&
      typeof (value as { size?: unknown }).size === "number" &&
      "arrayBuffer" in value &&
      typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function"
  );
}

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
      enhancementStatus: true,
      processingMetadata: true,
      category: true,
      categoryConfidence: true,
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

    // Support both "files" (batch) and "file" (single backward compat)
    let rawFiles = formData.getAll("files") as File[];
    if (rawFiles.length === 0) {
      const single = formData.get("file") as File | null;
      if (single) rawFiles = [single];
    }

    if (rawFiles.length === 0) {
      return NextResponse.json({ error: "请选择文件" }, { status: 400 });
    }

    if (rawFiles.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { error: `单次最多上传 ${MAX_FILES_PER_REQUEST} 个文件` },
        { status: 400 }
      );
    }

    const results: Array<{
      success: boolean;
      file?: Record<string, unknown>;
      error?: string;
      originalName?: string;
      note?: string;
    }> = [];

    for (const file of rawFiles) {
      try {
        if (!isUploadFile(file) || !file.name) {
          results.push({ success: false, error: "无效的文件" });
          continue;
        }

        if (file.size > MAX_FILE_SIZE) {
          results.push({
            success: false,
            originalName: file.name,
            error: `超过 20MB 限制`,
          });
          continue;
        }

        const originalName = file.name;
        const ext = path.extname(originalName).toLowerCase().slice(1);

        if (!CODE_EXTENSIONS[ext] && !DOCUMENT_EXTENSIONS[ext] && !IMAGE_EXTENSIONS[ext]) {
          results.push({
            success: false,
            originalName,
            error: `不支持的文件类型: .${ext}`,
          });
          continue;
        }

        const fileId = crypto.randomUUID();
        const mimeType =
          CODE_EXTENSIONS[ext] ||
          DOCUMENT_EXTENSIONS[ext] ||
          IMAGE_EXTENSIONS[ext] ||
          file.type ||
          "application/octet-stream";

        const buffer = Buffer.from(await file.arrayBuffer());
        const stored = await uploadFileBuffer({
          userId: session.user.id,
          projectId,
          fileId,
          originalName,
          mimeType,
          buffer,
        });

        const fileAsset = await prisma.fileAsset.create({
          data: {
            id: fileId,
            userId: session.user.id,
            projectId,
            filename: stored.filename,
            originalName,
            mimeType,
            size: file.size,
            storageProvider: stored.provider,
            storagePath: stored.key,
            textContent: null,
            status: "parsing",
            processingMetadata: {
              parsingStage: "converting",
              parsingStageLabel: "转换格式中",
              queuedAt: new Date().toISOString(),
            },
          },
        });

        results.push({
          success: true,
          file: {
            id: fileAsset.id,
            filename: fileAsset.filename,
            originalName: fileAsset.originalName,
            mimeType: fileAsset.mimeType,
            size: fileAsset.size,
            status: fileAsset.status,
            enhancementStatus: fileAsset.enhancementStatus,
            processingMetadata: fileAsset.processingMetadata,
            category: fileAsset.category,
            categoryConfidence: fileAsset.categoryConfidence,
            createdAt: fileAsset.createdAt,
          },
          note: "文件已进入解析队列",
        });
      } catch (fileErr) {
        console.error("File upload error:", fileErr);
        results.push({
          success: false,
          originalName: (file as File)?.name || "未知文件",
          error: "文件保存失败",
        });
      }
    }

    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    const queuedFileIds = succeeded
      .map((r) => r.file?.id)
      .filter((id): id is string => typeof id === "string");
    if (queuedFileIds.length > 0) {
      startFileParseBatch({
        userId: session.user.id,
        fileIds: queuedFileIds,
      });
    }

    return NextResponse.json(
      {
        files: succeeded.map((r) => r.file),
        errors: failed.map((r) => ({ name: r.originalName, error: r.error })),
        summary: {
          total: results.length,
          succeeded: succeeded.length,
          failed: failed.length,
        },
      },
      { status: succeeded.length > 0 ? 201 : 400 }
    );
  } catch (err) {
    console.error("File upload error:", err);
    return NextResponse.json(
      { error: "文件上传失败，请稍后重试" },
      { status: 500 }
    );
  }
}
