/**
 * 任务 08.1—08.3：聊天图片附件的持久化、消息绑定与补偿清理。
 *
 * 写入顺序：对象先落对象存储（键由 userId + clientRunKey + position + 内容哈希
 * 决定，重试覆盖同一对象，不产生重复副本），行先以 `pending` 状态存在；用户消息
 * 落库后再绑定 messageId 并置为 `bound`。重复提交（相同 clientRunKey）复用同一批
 * 行与对象，因此重试不会重复用户消息、附件或计费。
 *
 * 普通对话不会为了存图创建虚假 Project：附件只归属用户与消息，不依赖 FileAsset
 * 的解析语义；但读取与删除复用同一个对象存储适配器。
 */
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import {
  activeStorageProvider,
  deleteStoredObject,
  uploadObjectBuffer,
  type StorageProvider,
} from "@/lib/storage/object-storage";
import type { ServerFileAttachment } from "@/lib/chat/router";
import type { MediaRef } from "@/lib/agent/context/media-ref";

/** 缩略图长边上限；与展示尺寸匹配，不改变原图。 */
export const CHAT_ATTACHMENT_THUMBNAIL_MAX_EDGE = 512;
const THUMBNAIL_MIME = "image/webp";
/** 未绑定附件的最长保留时间；超过后由补偿清理回收对象与行。 */
export const UNBOUND_ATTACHMENT_TTL_HOURS = 24;

export interface PersistedChatAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  contentHash: string;
  storageProvider: string;
  storagePath: string;
  position: number;
  status: string;
  hasThumbnail: boolean;
}

/** 前端/历史接口使用的附件 DTO；URL 始终指向同源鉴权响应。 */
export interface ChatAttachmentDto {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  status: string;
  url: string;
  thumbnailUrl: string;
}

export function toChatAttachmentDto(row: {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  status: string;
  hasThumbnail: boolean;
}): ChatAttachmentDto {
  const base = `/api/chat/attachments/${row.id}`;
  return {
    id: row.id,
    name: row.originalName,
    mimeType: row.mimeType,
    size: row.size,
    width: row.width,
    height: row.height,
    status: row.status,
    url: `${base}?variant=original`,
    thumbnailUrl: base,
  };
}

/** 把本轮附件 DTO 编码进响应头，供乐观消息替换为持久附件。 */
export function encodeChatAttachmentsHeader(
  rows: PersistedChatAttachment[]
): string {
  return JSON.stringify(rows.map(toChatAttachmentDto));
}

/**
 * 历史消息读取附件的统一 select：聊天页服务端查询与 /api/conversations 共用，
 * 避免两处字段漂移导致"API 有附件、页面没有附件"。
 */
export const CHAT_ATTACHMENT_SELECT = {
  where: { status: "bound" },
  orderBy: { position: "asc" },
  select: {
    id: true,
    originalName: true,
    mimeType: true,
    size: true,
    width: true,
    height: true,
    position: true,
    status: true,
    thumbnailPath: true,
  },
} as const;

export function toChatAttachmentDtos(
  rows: Array<{
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    status: string;
    thumbnailPath: string | null;
  }>
): ChatAttachmentDto[] {
  return rows.map((row) =>
    toChatAttachmentDto({
      ...row,
      hasThumbnail: Boolean(row.thumbnailPath),
    })
  );
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

function safeExtension(mimeType: string, originalName: string): string {
  const byMime = MIME_EXTENSIONS[mimeType];
  if (byMime) return byMime;
  const ext = path.extname(originalName).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext.slice(1) : "bin";
}

function attachmentObjectKey(input: {
  userId: string;
  clientRunKey: string;
  position: number;
  contentHash: string;
  mimeType: string;
  originalName: string;
  thumbnail?: boolean;
}): string {
  const extension = input.thumbnail
    ? "webp"
    : safeExtension(input.mimeType, input.originalName);
  const suffix = input.thumbnail ? "-thumb" : "";
  return [
    "chat-attachments",
    input.userId,
    input.clientRunKey,
    `${input.position}-${input.contentHash.slice(0, 16)}${suffix}.${extension}`,
  ].join("/");
}

interface ImageProbe {
  width: number | null;
  height: number | null;
  thumbnail: Buffer | null;
}

/**
 * 探测图片尺寸并生成缩略图。签名校验已在 HTTP 边界完成；这里若解码失败
 * 仍保留原图（可查看），只是没有尺寸与缩略图，不阻断用户发送。
 */
async function probeImage(data: Buffer): Promise<ImageProbe> {
  try {
    const image = sharp(data, { failOn: "none" });
    const metadata = await image.metadata();
    const width = metadata.width ?? null;
    const height = metadata.height ?? null;
    const thumbnail = await sharp(data, { failOn: "none" })
      .rotate()
      .resize({
        width: CHAT_ATTACHMENT_THUMBNAIL_MAX_EDGE,
        height: CHAT_ATTACHMENT_THUMBNAIL_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 78 })
      .toBuffer();
    return { width, height, thumbnail };
  } catch {
    return { width: null, height: null, thumbnail: null };
  }
}

function toPersisted(row: {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  contentHash: string;
  storageProvider: string;
  storagePath: string;
  position: number;
  status: string;
  thumbnailPath: string | null;
}): PersistedChatAttachment {
  return {
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    size: row.size,
    width: row.width,
    height: row.height,
    contentHash: row.contentHash,
    storageProvider: row.storageProvider,
    storagePath: row.storagePath,
    position: row.position,
    status: row.status,
    hasThumbnail: Boolean(row.thumbnailPath),
  };
}

/** 持久化附件行 → 统一媒体引用，供 Checkpoint 与历史组装复用。 */
export function toMediaRef(row: PersistedChatAttachment): MediaRef {
  return {
    source: "message-attachment",
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    storageProvider: row.storageProvider,
    storagePath: row.storagePath,
    contentHash: row.contentHash,
  };
}

/**
 * 持久化本轮图片附件。仅处理图片；文本/PDF/DOCX 仍走既有的请求内提取链路，
 * 不在这里落库（历史纯文本消息的 attachments 因此默认为空）。
 */
export async function persistChatAttachments(input: {
  userId: string;
  clientRunKey: string;
  attachments: ServerFileAttachment[];
}): Promise<PersistedChatAttachment[]> {
  const images = input.attachments.filter((attachment) =>
    attachment.mimeType.startsWith("image/")
  );
  if (images.length === 0) return [];

  const provider = activeStorageProvider();
  const persisted: PersistedChatAttachment[] = [];

  for (const [position, attachment] of images.entries()) {
    const contentHash = createHash("sha256")
      .update(attachment.data)
      .digest("hex");
    const storagePath = attachmentObjectKey({
      userId: input.userId,
      clientRunKey: input.clientRunKey,
      position,
      contentHash,
      mimeType: attachment.mimeType,
      originalName: attachment.name,
    });

    const stored = await uploadObjectBuffer({
      key: storagePath,
      mimeType: attachment.mimeType,
      buffer: attachment.data,
    });

    const probe = await probeImage(attachment.data);
    let thumbnailPath: string | null = null;
    if (probe.thumbnail) {
      thumbnailPath = attachmentObjectKey({
        userId: input.userId,
        clientRunKey: input.clientRunKey,
        position,
        contentHash,
        mimeType: THUMBNAIL_MIME,
        originalName: attachment.name,
        thumbnail: true,
      });
      await uploadObjectBuffer({
        key: thumbnailPath,
        mimeType: THUMBNAIL_MIME,
        buffer: probe.thumbnail,
      });
    }

    const row = await prisma.messageAttachment.upsert({
      where: {
        userId_clientRunKey_position: {
          userId: input.userId,
          clientRunKey: input.clientRunKey,
          position,
        },
      },
      create: {
        userId: input.userId,
        clientRunKey: input.clientRunKey,
        originalName: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.data.length,
        width: probe.width,
        height: probe.height,
        contentHash,
        storageProvider: stored.provider,
        storagePath: stored.key,
        thumbnailProvider: thumbnailPath ? provider : null,
        thumbnailPath,
        position,
        status: "pending",
      },
      update: {
        originalName: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.data.length,
        width: probe.width,
        height: probe.height,
        contentHash,
        storageProvider: stored.provider,
        storagePath: stored.key,
        thumbnailProvider: thumbnailPath ? provider : null,
        thumbnailPath,
      },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        size: true,
        width: true,
        height: true,
        contentHash: true,
        storageProvider: true,
        storagePath: true,
        position: true,
        status: true,
        thumbnailPath: true,
      },
    });
    persisted.push(toPersisted(row));
  }

  // 重试时若本轮图片变少，回收多出来的未绑定行与对象，避免附件数与消息不符。
  const stale = await prisma.messageAttachment.findMany({
    where: {
      userId: input.userId,
      clientRunKey: input.clientRunKey,
      position: { gte: images.length },
      messageId: null,
    },
    select: {
      id: true,
      storageProvider: true,
      storagePath: true,
      thumbnailProvider: true,
      thumbnailPath: true,
    },
  });
  if (stale.length > 0) {
    await prisma.messageAttachment.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    });
    await deleteAttachmentObjects(stale);
  }

  return persisted;
}

/**
 * 把本轮已上传的附件绑定到刚落库的用户消息。只认领仍未绑定的行，
 * 因此重试（同一 clientRunKey）不会把附件改挂到别的消息上。
 */
export async function bindChatAttachmentsToMessage(input: {
  userId: string;
  clientRunKey: string;
  messageId: string;
}): Promise<number> {
  const result = await prisma.messageAttachment.updateMany({
    where: {
      userId: input.userId,
      clientRunKey: input.clientRunKey,
      messageId: null,
    },
    data: { messageId: input.messageId, status: "bound" },
  });
  return result.count;
}

/** 按资源 ID 读取附件引用，供 durable Checkpoint 恢复解析。 */
export async function loadAttachmentRefsByIds(input: {
  userId: string;
  ids: string[];
}): Promise<MediaRef[]> {
  if (input.ids.length === 0) return [];
  const rows = await prisma.messageAttachment.findMany({
    where: { userId: input.userId, id: { in: input.ids } },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      storageProvider: true,
      storagePath: true,
      contentHash: true,
    },
  });
  return rows.map((row) => ({
    source: "message-attachment" as const,
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    storageProvider: row.storageProvider,
    storagePath: row.storagePath,
    contentHash: row.contentHash,
  }));
}

interface AttachmentObject {
  storageProvider: string;
  storagePath: string;
  thumbnailProvider: string | null;
  thumbnailPath: string | null;
}

/**
 * 删除附件对象，但跳过仍被其他附件行、项目文件或文档资源引用的共享对象。
 * 这样清理会话/消息不会越界删除仍被引用的历史缓存。
 */
async function deleteAttachmentObjects(rows: AttachmentObject[]): Promise<void> {
  for (const row of rows) {
    const candidates: Array<{ provider: string; key: string }> = [
      { provider: row.storageProvider, key: row.storagePath },
      ...(row.thumbnailProvider && row.thumbnailPath
        ? [{ provider: row.thumbnailProvider, key: row.thumbnailPath }]
        : []),
    ];
    for (const candidate of candidates) {
      if (!candidate.key) continue;
      const [attachmentCount, fileCount, resourceCount] = await Promise.all([
        prisma.messageAttachment.count({
          where: { storagePath: candidate.key },
        }),
        prisma.fileAsset.count({ where: { storagePath: candidate.key } }),
        prisma.fileAssetResource.count({
          where: { storagePath: candidate.key },
        }),
      ]);
      if (attachmentCount > 0 || fileCount > 0 || resourceCount > 0) continue;
      await deleteStoredObject({
        provider: candidate.provider as StorageProvider,
        key: candidate.key,
      }).catch(() => {});
    }
  }
}

/** 会话删除前清理该会话全部附件的对象；行随消息级联删除。 */
export async function deleteConversationAttachmentObjects(input: {
  userId: string;
  conversationId: string;
}): Promise<void> {
  const rows = await prisma.messageAttachment.findMany({
    where: {
      userId: input.userId,
      message: { conversationId: input.conversationId },
    },
    select: {
      storageProvider: true,
      storagePath: true,
      thumbnailProvider: true,
      thumbnailPath: true,
    },
  });
  if (rows.length === 0) return;
  // 先删除行再删对象，避免共享判断把自己算成引用方。
  await prisma.messageAttachment.deleteMany({
    where: {
      userId: input.userId,
      message: { conversationId: input.conversationId },
    },
  });
  await deleteAttachmentObjects(rows);
}

/**
 * 补偿清理：回收长时间未绑定到消息的附件（上传成功但派发失败/客户端放弃）。
 * 返回清理的行数，供调用方记录。
 */
export async function cleanupUnboundChatAttachments(
  now: Date = new Date()
): Promise<{ rows: number }> {
  const cutoff = new Date(
    now.getTime() - UNBOUND_ATTACHMENT_TTL_HOURS * 60 * 60 * 1000
  );
  const rows = await prisma.messageAttachment.findMany({
    where: { messageId: null, createdAt: { lt: cutoff } },
    select: {
      id: true,
      storageProvider: true,
      storagePath: true,
      thumbnailProvider: true,
      thumbnailPath: true,
    },
  });
  if (rows.length === 0) return { rows: 0 };
  await prisma.messageAttachment.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  await deleteAttachmentObjects(rows);
  return { rows: rows.length };
}
