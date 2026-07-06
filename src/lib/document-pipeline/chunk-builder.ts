import crypto from "crypto";
import type { DocumentBlock, ImageBlock } from "./types";

export interface ChunkCandidate {
  id: string;
  content: string;
  metadata?: {
    sourceType?: string;
    blockId?: string;
    assetId?: string;
    pageNumber?: number;
    slideNumber?: number;
    confidence?: number;
    warnings?: string[];
  };
  mediaUrls: string[];
}

export function buildChunksFromBlocks(
  blocks: DocumentBlock[],
  assetResourceUrlMap: Map<string, string>,
  options: { maxChunkChars?: number; overlapChars?: number } = {}
): ChunkCandidate[] {
  const { maxChunkChars = 1500, overlapChars = 150 } = options;
  const chunks: ChunkCandidate[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "text":
      case "heading":
      case "code": {
        const text =
          block.type === "heading"
            ? `${"#".repeat(block.level)} ${block.content}`
            : block.type === "code"
              ? [`\`\`\`${block.language || ""}`, block.content, "```"].join("\n")
              : block.content;
        splitText(text, maxChunkChars, overlapChars).forEach((content) => {
          chunks.push({
            id: crypto.randomUUID(),
            content,
            metadata: {
              sourceType: "text",
              blockId: block.id,
              pageNumber: block.pageNumber,
              slideNumber: block.slideNumber,
            },
            mediaUrls: [],
          });
        });
        break;
      }
      case "table":
        chunks.push({
          id: crypto.randomUUID(),
          content: block.markdown,
          metadata: {
            sourceType: "table",
            blockId: block.id,
            pageNumber: block.pageNumber,
            slideNumber: block.slideNumber,
          },
          mediaUrls: [],
        });
        break;
      case "formula":
        chunks.push({
          id: crypto.randomUUID(),
          content: `$$${block.content}$$`,
          metadata: {
            sourceType: "formula",
            blockId: block.id,
            pageNumber: block.pageNumber,
            slideNumber: block.slideNumber,
          },
          mediaUrls: [],
        });
        break;
      case "image":
        chunks.push(...imageBlockChunks(block, assetResourceUrlMap));
        break;
      case "page-break":
        break;
    }
  }

  return chunks;
}

function imageBlockChunks(
  block: ImageBlock,
  assetResourceUrlMap: Map<string, string>
): ChunkCandidate[] {
  const resourceUrl = assetResourceUrlMap.get(block.relativePath) || "";
  const mediaUrls = resourceUrl ? [resourceUrl] : [];
  const warnings =
    block.analysisStatus === "failed" ? [block.skipReason || "视觉分析失败"] : [];

  const result: ChunkCandidate[] = [];

  if (block.visionSummary) {
    result.push({
      id: crypto.randomUUID(),
      content: block.visionSummary,
      metadata: {
        sourceType: "image_summary",
        blockId: block.id,
        assetId: block.assetId,
        pageNumber: block.pageNumber,
        slideNumber: block.slideNumber,
        confidence: block.confidence,
        warnings,
      },
      mediaUrls,
    });
  }

  if (block.visionText) {
    result.push({
      id: crypto.randomUUID(),
      content: block.visionText,
      metadata: {
        sourceType: "image_ocr",
        blockId: block.id,
        assetId: block.assetId,
        pageNumber: block.pageNumber,
        slideNumber: block.slideNumber,
        confidence: block.confidence,
        warnings,
      },
      mediaUrls,
    });
  }

  if (block.visionSummary || block.visionText) {
    return result;
  }

  // Fallback for unanalyzed images: index alt/path so the image itself is retrievable.
  result.push({
    id: crypto.randomUUID(),
    content: block.altText || `图片：${block.relativePath}`,
    metadata: {
      sourceType: "image_summary",
      blockId: block.id,
      assetId: block.assetId,
      pageNumber: block.pageNumber,
      slideNumber: block.slideNumber,
      warnings,
    },
    mediaUrls,
  });

  return result;
}

function splitText(text: string, size: number, overlap: number): string[] {
  if (!text || text.trim().length === 0) return [];
  if (text.length <= size) return [text.trim()];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const searchRegion = text.slice(end - overlap, end);
      const lastPara = searchRegion.lastIndexOf("\n\n");
      const lastPeriod = searchRegion.lastIndexOf("。\n");
      let breakPoint = -1;
      if (lastPara !== -1) breakPoint = end - overlap + lastPara + 2;
      else if (lastPeriod !== -1) breakPoint = end - overlap + lastPeriod + 1;
      if (breakPoint > start) end = breakPoint;
    }
    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start < 0) start = 0;
    if (start >= text.length - overlap && end >= text.length) break;
  }

  return chunks.filter((c) => c.length > 0);
}
