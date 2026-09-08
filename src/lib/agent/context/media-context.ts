/**
 * 项目图片 → 最终多模态模型上下文（任务 05.3—05.5，08.2 统一引用合同）。
 *
 * 全部活跃模型都能看图：项目图片不再经过独立 OCR/摘要，而是把原图作为
 * input_image 附件交给用户所选模型。媒体引用合同见 `media-ref.ts`：
 * 平台资源 ID + 版本定位（contentHash/fingerprint）+ mimeType + 对象位置 +
 * 原始顺序；字节读取与数量/字节预算由共享 loader 统一执行，项目图片与
 * 消息附件（任务 08）共用同一条输入组装路径。
 */
import { prisma } from "@/lib/db";
import type { ServerFileAttachment } from "@/lib/chat/router";
import {
  MAX_AUTO_MEDIA_IMAGES,
  MAX_MEDIA_BYTES,
  MAX_MEDIA_IMAGES,
  loadMediaRefsWithinBudget,
  type MediaRef,
} from "@/lib/agent/context/media-ref";

/** 显式选中的图片单次请求上限；超出部分在覆盖说明中指明。 */
export const MAX_SELECTED_PROJECT_IMAGES = MAX_MEDIA_IMAGES;
/** 未显式选择时自动携带的候选上限；超出提示缩小范围，不恢复后台 OCR。 */
export const MAX_AUTO_PROJECT_IMAGES = MAX_AUTO_MEDIA_IMAGES;
/** 单次请求图片总字节预算。 */
export const MAX_PROJECT_IMAGES_BYTES = MAX_MEDIA_BYTES;

export interface ProjectImageAsset {
  id: string;
  originalName: string;
  mimeType: string;
  storageProvider: string;
  storagePath: string;
}

export interface ProjectMediaContext {
  attachments: ServerFileAttachment[];
  /** 进入提示词的覆盖范围说明（哪些图片被携带/哪些被截断）。 */
  coverageNote: string | null;
}

function extensionKeywords(name: string): string[] {
  const base = name.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
  return base
    .split(/[\s_\-.]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function promptMentionsAsset(prompt: string, assetName: string): boolean {
  const lowered = prompt.toLowerCase();
  return extensionKeywords(assetName).some(
    (token) => token.length >= 2 && lowered.includes(token)
  );
}

/** 按顺序加载图片资产，尊重字节预算；返回附件与未加载清单。 */
async function loadWithinBudget(
  assets: ProjectImageAsset[]
): Promise<{ attachments: ServerFileAttachment[]; missed: string[] }> {
  // 数量上限由调用方在挑选候选时应用，这里只负责字节预算与读取失败。
  return loadMediaRefsWithinBudget(assets.map(toProjectMediaRef), {
    maxCount: assets.length,
  });
}

function toProjectMediaRef(asset: ProjectImageAsset): MediaRef {
  return {
    source: "project-file",
    id: asset.id,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    storageProvider: asset.storageProvider,
    storagePath: asset.storagePath,
  };
}

function buildCoverageNote(options: {
  included: number;
  missed: string[];
  autoMode: boolean;
}): string | null {
  const { included, missed, autoMode } = options;
  if (missed.length === 0 && included === 0 && !autoMode) return null;
  const parts: string[] = [];
  if (included > 0) {
    parts.push(
      autoMode
        ? `本次自动携带了 ${included} 张项目图片（未逐张确认，基于文件名与问题匹配或少量候选直接附带）。`
        : `本次携带了你选中的 ${included} 张项目图片原图。`
    );
  }
  if (missed.length > 0) {
    parts.push(
      `以下 ${missed.length} 张图片因数量/大小预算未随本次请求携带：${missed
        .slice(0, 8)
        .join("、")}${missed.length > 8 ? "等" : ""}。请缩小选中范围或分批提问。`
    );
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * 汇总本次请求应携带的项目图片：
 * 1) 显式选中的图片无条件进入（上限内），且已由 ContextAssembler 完成归属校验；
 * 2) 未选文件时按文件名/用户描述匹配少量候选，不做图像语义检索；
 * 3) 项目整库快捷任务把图片纳入覆盖范围并显式说明，不静默忽略。
 */
export async function resolveProjectMediaContext(input: {
  userId: string;
  projectId: string;
  selectedFiles: Array<{ id: string; originalName: string; mimeType: string }>;
  prompt: string;
  includeProjectImages: boolean;
  wholeCorpus: boolean;
}): Promise<ProjectMediaContext> {
  const selectedImages = input.selectedFiles
    .filter((file) => file.mimeType.startsWith("image/"))
    .slice(0, MAX_SELECTED_PROJECT_IMAGES);

  const missedByCap =
    input.selectedFiles.filter((file) => file.mimeType.startsWith("image/"))
      .length - selectedImages.length;

  if (selectedImages.length > 0) {
    const assets = await prisma.fileAsset.findMany({
      where: {
        id: { in: selectedImages.map((file) => file.id) },
        userId: input.userId,
        projectId: input.projectId,
        mimeType: { startsWith: "image/" },
      },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        storageProvider: true,
        storagePath: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const { attachments, missed } = await loadWithinBudget(assets);
    const missedNames = [
      ...missed,
      ...Array.from({ length: Math.max(0, missedByCap) }, () => "（更多选中图片）"),
    ];
    return {
      attachments,
      coverageNote: buildCoverageNote({
        included: attachments.length,
        missed: missedNames,
        autoMode: false,
      }),
    };
  }

  if (!input.includeProjectImages && !input.wholeCorpus) {
    return { attachments: [], coverageNote: null };
  }

  const projectImages = await prisma.fileAsset.findMany({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      mimeType: { startsWith: "image/" },
      status: { in: ["parsed", "partial", "uploaded"] },
    },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      storageProvider: true,
      storagePath: true,
    },
    orderBy: { createdAt: "asc" },
  });
  if (projectImages.length === 0) {
    return { attachments: [], coverageNote: null };
  }

  let candidates = projectImages;
  const autoMode = true;
  if (!input.wholeCorpus && projectImages.length > MAX_AUTO_PROJECT_IMAGES) {
    const mentioned = projectImages.filter((asset) =>
      promptMentionsAsset(input.prompt, asset.originalName)
    );
    candidates = mentioned.slice(0, MAX_AUTO_PROJECT_IMAGES);
  } else if (projectImages.length > MAX_AUTO_PROJECT_IMAGES) {
    candidates = projectImages.slice(0, MAX_AUTO_PROJECT_IMAGES);
  }

  const { attachments, missed } = await loadWithinBudget(candidates);
  const skippedCount = projectImages.length - candidates.length;
  const missedNames = [
    ...missed,
    ...Array.from(
      { length: Math.max(0, skippedCount - missed.length) },
      () => "（其余未匹配项目图片）"
    ),
  ];
  return {
    attachments,
    coverageNote: buildCoverageNote({
      included: attachments.length,
      missed: missedNames,
      autoMode,
    }),
  };
}
