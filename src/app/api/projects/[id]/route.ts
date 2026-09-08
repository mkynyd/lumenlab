import { ALL_CHAT_MODELS, LEGACY_CHAT_MODELS, activeModelForStoredModel } from "@/lib/chat/model-catalog";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { deleteStoredObject, type StorageProvider } from "@/lib/storage/object-storage";
import { logger } from "@/lib/logger";

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  type: z.enum(["experiment", "review", "coding", "general"]).optional(),
  defaultModel: z.enum([...ALL_CHAT_MODELS, ...LEGACY_CHAT_MODELS]).transform(activeModelForStoredModel).optional(),
  thinkingEnabled: z.boolean().optional(),
  systemPrompt: z.string().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;

  const project = await prisma.project.findFirst({
    where: { id, userId: session.user.id },
    include: {
      files: {
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
      },
      conversations: {
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          model: true,
          thinkingEnabled: true,
          updatedAt: true,
        },
      },
      quickActions: {
        orderBy: [{ isSystem: "desc" }, { sortOrder: "asc" }],
        select: {
          id: true,
          title: true,
          prompt: true,
          isSystem: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      _count: {
        select: { conversations: true, files: true },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json({ project });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;

  const project = await prisma.project.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: z.infer<typeof updateProjectSchema>;
  try {
    const raw = await request.json();
    const parsed = updateProjectSchema.safeParse(raw);
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

  const updated = await prisma.project.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.type !== undefined && { type: body.type }),
      ...(body.defaultModel !== undefined && { defaultModel: body.defaultModel }),
      ...(body.thinkingEnabled !== undefined && { thinkingEnabled: body.thinkingEnabled }),
      ...(body.systemPrompt !== undefined && { systemPrompt: body.systemPrompt }),
    },
  });

  return NextResponse.json({ project: updated });
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

  const project = await prisma.project.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const files = await prisma.fileAsset.findMany({
    where: { projectId: id, userId: session.user.id },
    select: {
      storageProvider: true,
      storagePath: true,
      resources: {
        select: { storageProvider: true, storagePath: true },
      },
    },
  });
  await Promise.all(
    files.flatMap((file) => [
      deleteStoredObject({
        provider: file.storageProvider as StorageProvider,
        key: file.storagePath,
      }).catch((error) => {
        logger.warn("项目文件对象删除失败", { projectId: id, error: String(error) });
      }),
      ...file.resources.map((resource) =>
        deleteStoredObject({
          provider: resource.storageProvider as StorageProvider,
          key: resource.storagePath,
        }).catch((error) => {
          logger.warn("项目文件图片对象删除失败", {
            projectId: id,
            error: String(error),
          });
        })
      ),
    ])
  );

  await prisma.$transaction([
    prisma.conversation.deleteMany({
      where: { projectId: id, userId: session.user.id },
    }),
    prisma.project.delete({ where: { id } }),
  ]);

  return NextResponse.json({ success: true });
}
