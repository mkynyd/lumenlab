import { prisma } from "@/lib/db";

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
    },
  });
  if (!file) {
    return { error: "NOT_FOUND" };
  }
  const text = file.enhancedContent || file.textContent || "";
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