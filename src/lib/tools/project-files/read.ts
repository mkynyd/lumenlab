import { prisma } from "@/lib/db";
import { getEffectiveFileContent } from "@/lib/files/content-fingerprint";

export async function readProjectFile(
  userId: string,
  projectId: string,
  fileId: string,
  maxChars = 8000
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
  const truncated = text.length > maxChars ? text.slice(0, maxChars) : text;
  return {
    id: file.id,
    name: file.originalName,
    mimeType: file.mimeType,
    status: file.status,
    textLength: text.length,
    text: truncated,
    truncated: text.length > maxChars,
  };
}
