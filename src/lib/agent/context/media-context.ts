/**
 * 项目图片 → 最终多模态模型上下文（任务 05.3—05.5）。
 *
 * 全部活跃模型都能看图：项目图片不再经过独立 OCR/摘要，而是把原图作为
 * input_image 附件交给用户所选模型。媒体引用合同（05.1，与 01 消息合同
 * 共用）：平台 fileAssetId + contentFingerprint（版本定位）+ mimeType +
 * 所属消息/项目 + 原始顺序；图片 Buffer 仍只在请求内存在，持久化归 08。
 */
import { prisma } from "@/lib/db";
import { readStoredObject, type StorageProvider } from "@/lib/storage/object-storage";
import type { ServerFileAttachment } from "@/lib/chat/router";

/** 显式选中的图片单次请求上限；超出部分在覆盖说明中指明。 */
export const MAX_SELECTED_PROJECT_IMAGES = 6;
/** 未显式选择时自动携带的候选上限；超出提示缩小范围，不恢复后台 OCR。 */
export const MAX_AUTO_PROJECT_IMAGES = 4;
/** 单次请求图片总字节预算。 */
export const MAX_PROJECT_IMAGES_BYTES = 24 * 1024 * 1024;

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

async function loadImageAsset(
  asset: ProjectImageAsset
): Promise<ServerFileAttachment | null> {
  try {
    const data = await readStoredObject({
      provider: asset.storageProvider as StorageProvider,
      key: asset.storagePath,
    });
    return {
      name: asset.originalName,
      mimeType: asset.mimeType,
      size: data.length,
      data,
    };
  } catch {
    // 单张图片读取失败不阻塞整次请求；缺失信息进入覆盖说明。
    return null;
  }
}

/** 按顺序加载图片资产，尊重字节预算；返回附件与未加载清单。 */
async function loadWithinBudget(
  assets: ProjectImageAsset[]
): Promise<{ attachments: ServerFileAttachment[]; missed: string[] }> {
  const attachments: ServerFileAttachment[] = [];
  const missed: string[] = [];
  let totalBytes = 0;
  for (const asset of assets) {
    if (totalBytes >= MAX_PROJECT_IMAGES_BYTES) {
      missed.push(asset.originalName);
      continue;
    }
    const loaded = await loadImageAsset(asset);
    if (!loaded) {
      missed.push(asset.originalName);
      continue;
    }
    if (totalBytes + loaded.size > MAX_PROJECT_IMAGES_BYTES) {
      missed.push(asset.originalName);
      continue;
    }
    totalBytes += loaded.size;
    attachments.push(loaded);
  }
  return { attachments, missed };
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
