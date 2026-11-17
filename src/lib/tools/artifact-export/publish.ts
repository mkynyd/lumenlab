import { artifactDownloadFormats, artifactDownloadUrl, type ArtifactDownloadFormat } from "@/lib/artifacts/download";
import { buildExportCacheKey, setCachedExport } from "@/lib/cache/export-cache";
import { renderArtifactFile } from "@/lib/export/artifact-file";
import { prisma } from "@/lib/db";
import { safeExportFilename } from "@/lib/export/filename";
import type { ToolExecutionContext } from "@/lib/agent/tool-executor";
import { saveArtifact } from "@/lib/tools/artifacts/save";

export async function publishArtifact(ctx: ToolExecutionContext, input: {
  title: string;
  content: string;
  format: ArtifactDownloadFormat;
}) {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || !content) throw new Error("文件需要标题和正文");
  if (title.length > 150 || content.length > 300_000) throw new Error("文件标题或正文超限");
  const body = await renderArtifactFile(content, title, input.format, ctx.signal);
  if (!body.length) throw new Error("未生成文件");
  ctx.signal?.throwIfAborted();
  const run = ctx.agentExecutionId ? await prisma.agentExecution.findFirst({
    where: { id: ctx.agentExecutionId, userId: ctx.userId, conversationId: ctx.conversationId },
    select: { assistantMessageId: true },
  }) : null;
  const artifact = await saveArtifact(ctx.userId, ctx.projectId, ctx.conversationId, run?.assistantMessageId ?? undefined, {
    title,
    content,
    type: "general",
    delivery: input.format,
  });
  const id = String(artifact.id);
  if (input.format !== "markdown") {
    await setCachedExport(buildExportCacheKey(id, input.format, content), body);
  }
  return {
    artifactId: id,
    format: input.format,
    filename: safeExportFilename(title, artifactDownloadFormats[input.format].extension),
    downloadUrl: artifactDownloadUrl(id, input.format),
    bytes: body.byteLength,
  };
}
