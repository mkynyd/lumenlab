import { prisma } from "@/lib/db";
import { getEffectiveFileContent } from "@/lib/files/content-fingerprint";

export async function readProjectFile(
  userId: string,
  projectId: string,
  fileId: string,
  maxChars = 8000,
  offset = 0
): Promise<Record<string, unknown>> {
  const file = await prisma.fileAsset.findFirst({
    where: { id: fileId, userId, projectId },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      status: true,
      textContent: true,
      enhancedContent: true,
      enhancementStatus: true,
    },
  });
  if (!file) {
    return { error: "NOT_FOUND" };
  }
  const text = getEffectiveFileContent(file);
  // 支持翻页:offset 定位起始位置,nextOffset 提示后续内容位置,
  // 修复此前长文档只能读到开头的问题。
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const slice = text.slice(safeOffset, safeOffset + maxChars);
  const reachedEnd = safeOffset + slice.length >= text.length;
  return {
    id: file.id,
    name: file.originalName,
    mimeType: file.mimeType,
    status: file.status,
    textLength: text.length,
    offset: safeOffset,
    nextOffset: reachedEnd ? null : safeOffset + slice.length,
    text: slice,
    truncated: !reachedEnd,
  };
}
