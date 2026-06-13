/**
 * Vector store — DocumentChunk CRUD and similarity search.
 * Uses pgvector <-> distance operator via Prisma raw queries.
 *
 * MVP: chunk text only, no embedding. Embedding field is reserved for later.
 */

import { prisma } from "@/lib/db";
import crypto from "crypto";

// ============================================================
// Configuration
// ============================================================

/** Embedding dimensions — change this when connecting an embedding model */
export const EMBEDDING_DIM = 1536;

/** Default chunk size in characters */
const CHUNK_SIZE = 1500;

/** Overlap between consecutive chunks in characters */
const CHUNK_OVERLAP = 150;

// ============================================================
// Types
// ============================================================

export interface CreateChunksParams {
  fileAssetId: string;
  projectId: string | null;
  userId: string;
  textContent: string;
  title?: string;
}

export interface SearchParams {
  userId: string;
  projectId?: string;
  /** Query embedding vector (if available) */
  queryEmbedding?: number[];
  limit?: number;
}

export interface ChunkSearchResult {
  id: string;
  content: string;
  title: string | null;
  fileAssetId: string | null;
  projectId: string | null;
  chunkIndex: number;
  distance: number;
}

// ============================================================
// Text splitting
// ============================================================

/**
 * Split text into overlapping chunks by character count.
 * Tries to break at paragraph boundaries within the limit.
 */
function splitTextIntoChunks(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (!text || text.trim().length === 0) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + size;
    if (end >= text.length) {
      chunks.push(text.slice(start).trim());
      break;
    }

    // Try to break at a paragraph boundary (double newline or period+newline)
    const searchRegion = text.slice(end - overlap, end);
    const lastPara = searchRegion.lastIndexOf("\n\n");
    const lastPeriod = searchRegion.lastIndexOf("。\n");

    let breakPoint = -1;
    if (lastPara !== -1) breakPoint = end - overlap + lastPara + 2;
    else if (lastPeriod !== -1) breakPoint = end - overlap + lastPeriod + 1;

    if (breakPoint !== -1 && breakPoint > start) {
      end = breakPoint;
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start < 0) start = 0;
  }

  return chunks.filter((c) => c.length > 0);
}

// ============================================================
// Chunk CRUD
// ============================================================

/**
 * Split text content into chunks and insert into DocumentChunk table.
 * Deletes existing chunks for the same fileAssetId first.
 * MVP: no embedding — only stores content.
 */
export async function createDocumentChunks(params: CreateChunksParams): Promise<number> {
  const { fileAssetId, projectId, userId, textContent, title } = params;

  // Delete existing chunks for this file
  await prisma.documentChunk.deleteMany({
    where: { fileAssetId, userId },
  });

  const texts = splitTextIntoChunks(textContent);
  if (texts.length === 0) return 0;

  const contentHash = crypto
    .createHash("sha256")
    .update(textContent)
    .digest("hex")
    .slice(0, 32);

  // Batch insert
  const data = texts.map((content, i) => ({
    userId,
    projectId,
    fileAssetId,
    title: title || null,
    content,
    contentHash,
    chunkIndex: i,
    tokenCount: Math.ceil(content.length / 2), // rough estimate: ~2 chars per token
  }));

  await prisma.documentChunk.createMany({ data });

  return texts.length;
}

/**
 * Search similar chunks by embedding vector using pgvector <-> operator.
 * Returns empty array if queryEmbedding is not provided (MVP).
 * Results are scoped by userId.
 */
export async function searchSimilarChunks(
  params: SearchParams
): Promise<ChunkSearchResult[]> {
  const { userId, projectId, queryEmbedding, limit = 10 } = params;

  // MVP: no embedding → return empty
  if (!queryEmbedding || queryEmbedding.length !== EMBEDDING_DIM) {
    return [];
  }

  const vectorStr = `[${queryEmbedding.join(",")}]`;

  const projectFilter = projectId
    ? `AND "projectId" = '${projectId}'`
    : "";

  // Use raw SQL for pgvector distance operator
  const rows = await prisma.$queryRawUnsafe<ChunkSearchResult[]>(
    `SELECT
      id, content, title, "fileAssetId", "projectId", "chunkIndex",
      embedding <-> $1::vector AS distance
    FROM "DocumentChunk"
    WHERE "userId" = $2
      AND embedding IS NOT NULL
      ${projectFilter}
    ORDER BY embedding <-> $1::vector
    LIMIT $3`,
    vectorStr,
    userId,
    limit
  );

  return rows || [];
}

/**
 * Delete all chunks for a file asset. Verifies userId ownership.
 */
export async function deleteChunksByFileAsset(
  fileAssetId: string,
  userId: string
): Promise<number> {
  const result = await prisma.documentChunk.deleteMany({
    where: { fileAssetId, userId },
  });
  return result.count;
}

/**
 * Get all chunks for a file asset (no embedding needed).
 */
export async function getChunksByFileAsset(
  fileAssetId: string,
  userId: string
) {
  return prisma.documentChunk.findMany({
    where: { fileAssetId, userId },
    orderBy: { chunkIndex: "asc" },
    select: {
      id: true,
      content: true,
      chunkIndex: true,
      tokenCount: true,
    },
  });
}
