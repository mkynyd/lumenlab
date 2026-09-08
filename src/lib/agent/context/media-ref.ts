/**
 * 任务 08.2：统一媒体引用合同（与 05 的项目图片路径共用）。
 *
 * 项目 FileAsset 与消息附件都通过同一组字段定位一个可读对象：
 * 来源 + 平台资源 ID + 版本定位（contentHash/fingerprint）+ mime + 对象位置。
 * 字节只在本模块的单一 loader 里读取，转成 `ServerFileAttachment` 后交给既有
 * Responses serializer；项目图片和消息附件不再各写一套输入组装逻辑。
 */
import {
  readStoredObject,
  type StorageProvider,
} from "@/lib/storage/object-storage";
import type { ServerFileAttachment } from "@/lib/chat/router";

export type MediaRefSource = "message-attachment" | "project-file";

export interface MediaRef {
  /** 资源归属类型：消息附件（任务 08）或项目文件（任务 05）。 */
  source: MediaRefSource;
  /** MessageAttachment.id 或 FileAsset.id，始终是平台资源 ID。 */
  id: string;
  originalName: string;
  mimeType: string;
  storageProvider: string;
  storagePath: string;
  /** 版本定位：消息附件用 sha256，项目文件用 contentFingerprint。 */
  contentHash?: string | null;
}

/** 显式选中媒体的单次请求上限；超出部分进入覆盖说明。 */
export const MAX_MEDIA_IMAGES = 6;
/** 未显式选择时自动携带的候选上限。 */
export const MAX_AUTO_MEDIA_IMAGES = 4;
/** 单次请求媒体总字节预算。 */
export const MAX_MEDIA_BYTES = 24 * 1024 * 1024;

export interface LoadedMedia {
  attachments: ServerFileAttachment[];
  /** 因读取失败或超出数量/字节预算而未携带的名称。 */
  missed: string[];
}

async function readMediaRef(ref: MediaRef): Promise<ServerFileAttachment | null> {
  try {
    const data = await readStoredObject({
      provider: ref.storageProvider as StorageProvider,
      key: ref.storagePath,
    });
    return {
      name: ref.originalName,
      mimeType: ref.mimeType,
      size: data.length,
      data,
    };
  } catch {
    // 单个对象读取失败不阻塞整次请求；缺失信息进入覆盖说明。
    return null;
  }
}

/**
 * 按给定顺序加载媒体引用，尊重数量与字节预算。
 * 顺序即优先级：调用方负责先排显式选中/最近使用，再排自动候选。
 */
export async function loadMediaRefsWithinBudget(
  refs: MediaRef[],
  options: { maxCount?: number; maxBytes?: number } = {}
): Promise<LoadedMedia> {
  const maxCount = options.maxCount ?? MAX_MEDIA_IMAGES;
  const maxBytes = options.maxBytes ?? MAX_MEDIA_BYTES;
  const attachments: ServerFileAttachment[] = [];
  const missed: string[] = [];
  let totalBytes = 0;
  for (const ref of refs) {
    if (attachments.length >= maxCount) {
      missed.push(ref.originalName);
      continue;
    }
    if (totalBytes >= maxBytes) {
      missed.push(ref.originalName);
      continue;
    }
    const loaded = await readMediaRef(ref);
    if (!loaded) {
      missed.push(ref.originalName);
      continue;
    }
    if (totalBytes + loaded.size > maxBytes) {
      missed.push(ref.originalName);
      continue;
    }
    totalBytes += loaded.size;
    attachments.push(loaded);
  }
  return { attachments, missed };
}

export function isImageMediaRef(ref: Pick<MediaRef, "mimeType">): boolean {
  return ref.mimeType.startsWith("image/");
}
