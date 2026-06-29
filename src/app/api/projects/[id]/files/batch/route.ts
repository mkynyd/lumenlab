import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteChunksByFileAsset } from "@/lib/rag/vector-store";
import { FILE_CATEGORIES } from "@/lib/file-categories";
import { refreshProjectIndex } from "@/lib/rag/project-index";
import { startFileParseBatch } from "@/lib/files/parse-job";
import { deleteStoredObject, type StorageProvider } from "@/lib/storage/object-storage";
import { logger } from "@/lib/logger";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { invalidateSearchCache } from "@/lib/cache/rag-search-cache";
import { invalidateFileSelectCache } from "@/lib/cache/rag-file-select-cache";

const batchFileSchema = z.object({
  action: z.enum(["delete", "reparse", "download"]),
  fileIds: z.array(z.string().min(1)).min(1).max(100),
  category: z.enum(FILE_CATEGORIES).optional(),
});

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeProjectName(name: string) {
  return name.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "project";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { allowed } = await checkRateLimit(
    `file-batch:${session.user.id}`,
    RateLimits.FILE_UPLOAD.max,
    RateLimits.FILE_UPLOAD.window
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "请求太频繁，请稍后重试" },
      { status: 429 }
    );
  }

  const { id: projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: session.user.id },
    select: { id: true, name: true },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: z.infer<typeof batchFileSchema>;
  try {
    const parsed = batchFileSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "无效的 JSON 格式" }, { status: 400 });
  }

  const fileIds = [...new Set(body.fileIds)];
  const files = await prisma.fileAsset.findMany({
    where: {
      id: { in: fileIds },
      userId: session.user.id,
      projectId,
    },
  });

  if (files.length !== fileIds.length) {
    return NextResponse.json(
      { error: "部分文件不存在或不属于当前项目" },
      { status: 400 }
    );
  }

  if (body.action === "download") {
    const content = files
      .map((file) => [
        `# ${file.originalName}`,
        "",
        file.textContent || "[该文件暂无已解析 Markdown 内容]",
      ].join("\n"))
      .join("\n\n---\n\n");

    return NextResponse.json({
      filename: `${safeProjectName(project.name)}_批量导出_${timestampForFilename()}.md`,
      content,
    });
  }

  if (body.action === "delete") {
    await Promise.all(
      files.map(async (file) => {
        await deleteChunksByFileAsset(file.id, session.user.id);
        if (file.storagePath) {
          await deleteStoredObject({
            provider: file.storageProvider as StorageProvider,
            key: file.storagePath,
          }).catch((error) => {
            logger.warn("文件对象删除失败", { fileId: file.id, error: String(error) });
          });
        }
      })
    );
    await prisma.fileAsset.deleteMany({
      where: { id: { in: fileIds }, userId: session.user.id, projectId },
    });
    await invalidateSearchCache(projectId);
    await invalidateFileSelectCache(projectId);
    await refreshProjectIndex({
      userId: session.user.id,
      projectId,
    }).catch(() => {});
    return NextResponse.json({ deleted: fileIds.length });
  }

  if (body.action === "reparse") {
    await prisma.fileAsset.updateMany({
      where: { id: { in: fileIds }, userId: session.user.id, projectId },
      data: {
        status: "parsing",
        processingMetadata: {
          parsingStage: "uploading",
          parsingStageLabel: "上传文件中",
          queuedAt: new Date().toISOString(),
        },
      },
    });
    startFileParseBatch({
      userId: session.user.id,
      fileIds,
    });
    return NextResponse.json({ queued: fileIds.length });
  }

  if (body.category) {
    await prisma.fileAsset.updateMany({
      where: { id: { in: fileIds }, userId: session.user.id, projectId },
      data: {
        category: body.category,
        categoryConfidence: null,
      },
    });
    await refreshProjectIndex({
      userId: session.user.id,
      projectId,
    }).catch(() => {});
    return NextResponse.json({ updated: fileIds.length });
  }

  return NextResponse.json(
    { error: "未提供可执行的批量操作" },
    { status: 400 }
  );
}
