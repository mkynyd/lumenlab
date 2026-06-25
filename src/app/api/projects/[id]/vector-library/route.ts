import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildVectorLibraryGraph } from "@/lib/rag/vector-library";
import type { ProjectFile } from "@/lib/api/types";

function extractParseError(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as Record<string, unknown>).parseError;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id: projectId } = await params;

  const rawFiles = await prisma.fileAsset.findMany({
    where: { projectId, userId: session.user.id },
    select: {
      id: true,
      filename: true,
      originalName: true,
      mimeType: true,
      size: true,
      status: true,
      category: true,
      categoryConfidence: true,
      enhancementStatus: true,
      processingMetadata: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const chunks = await prisma.documentChunk.findMany({
    where: { projectId, userId: session.user.id },
    select: {
      id: true,
      fileAssetId: true,
      content: true,
      chunkIndex: true,
      tokenCount: true,
    },
    orderBy: { chunkIndex: "asc" },
  });

  const chunksByFile: Record<
    string,
    { id: string; content: string; chunkIndex: number; tokenCount: number | null }[]
  > = {};
  for (const chunk of chunks) {
    if (!chunk.fileAssetId) continue;
    const list = chunksByFile[chunk.fileAssetId] || [];
    list.push(chunk);
    chunksByFile[chunk.fileAssetId] = list;
  }

  const files: ProjectFile[] = rawFiles.map((file) => ({
    ...file,
    createdAt: file.createdAt.toISOString(),
    processingError: extractParseError(file.processingMetadata),
    processingMetadata: file.processingMetadata as Record<string, unknown> | null,
  }));

  const graph = buildVectorLibraryGraph(files, chunksByFile);

  return NextResponse.json({ graph });
}
