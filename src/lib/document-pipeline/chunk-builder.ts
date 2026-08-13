import crypto from "crypto";
import type { DocumentBlock, ImageBlock } from "./types";

export interface ChunkCandidate {
  id: string;
  content: string;
  metadata?: {
    sourceType?: string;
    blockId?: string;
    /** Stable within one parse result: sha256(blockId:index:content). */
    blockKey?: string;
    /** Chunk-content fingerprint for cross-rebuild comparison. */
    contentFingerprint?: string;
    assetId?: string;
    pageNumber?: number;
    slideNumber?: number;
    confidence?: number;
    warnings?: string[];
  };
  mediaUrls: string[];
}

function blockKeyFor(blockId: string, index: number, content: string): string {
  return crypto
    .createHash("sha256")
    .update(`${blockId}:${index}:${content}`)
    .digest("hex")
    .slice(0, 24);
}

function chunkFingerprint(content: string): string {
  return crypto
    .createHash("sha256")
    .update(content)
    .digest("hex")
    .slice(0, 32);
}

export function buildChunksFromBlocks(
  blocks: DocumentBlock[],
  assetResourceUrlMap: Map<string, string>,
  options: { maxChunkChars?: number; overlapChars?: number } = {}
): ChunkCandidate[] {
  const { maxChunkChars = 1500, overlapChars = 150 } = options;
  const chunks: ChunkCandidate[] = [];
  // 正文块前缀最近标题,让中部段落 chunk 自带章节上下文。
  let currentHeading = "";

  for (const block of blocks) {
    if (block.type === "heading") {
      currentHeading = "#".repeat(block.level) + " " + block.content;
    }
    switch (block.type) {
      case "text":
      case "heading":
      case "code": {
        const text =
          block.type === "heading"
            ? `${"#".repeat(block.level)} ${block.content}`
            : block.type === "code"
              ? [`\`\`\`${block.language || ""}`, block.content, "```"].join("\n")
              : block.type === "text" && currentHeading
                ? currentHeading + "\n" + block.content
                : block.content;
        splitText(text, maxChunkChars, overlapChars).forEach(
          (content, index) => {
            chunks.push({
              id: crypto.randomUUID(),
              content,
              metadata: {
                sourceType: block.type,
                blockId: block.id,
                blockKey: blockKeyFor(block.id, index, content),
                contentFingerprint: chunkFingerprint(content),
                pageNumber: block.pageNumber,
                slideNumber: block.slideNumber,
              },
              mediaUrls: [],
            });
          }
        );
        break;
      }
      case "table":
        chunks.push({
          id: crypto.randomUUID(),
          content: block.markdown,
          metadata: {
            sourceType: "table",
            blockId: block.id,
            blockKey: blockKeyFor(block.id, 0, block.markdown),
            contentFingerprint: chunkFingerprint(block.markdown),
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
            blockKey: blockKeyFor(block.id, 0, `$$${block.content}$$`),
            contentFingerprint: chunkFingerprint(`$$${block.content}$$`),
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
        blockKey: blockKeyFor(block.id, 0, block.visionSummary),
        contentFingerprint: chunkFingerprint(block.visionSummary),
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
        blockKey: blockKeyFor(block.id, 0, block.visionText),
        contentFingerprint: chunkFingerprint(block.visionText),
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
  const fallbackContent = block.altText || `图片：${block.relativePath}`;
  result.push({
    id: crypto.randomUUID(),
    content: fallbackContent,
    metadata: {
      sourceType: "image_fallback",
      blockId: block.id,
      blockKey: blockKeyFor(block.id, 0, fallbackContent),
      contentFingerprint: chunkFingerprint(fallbackContent),
      assetId: block.assetId,
      pageNumber: block.pageNumber,
      slideNumber: block.slideNumber,
      confidence: block.confidence,
      warnings,
    },
    mediaUrls,
  });

  return result;
}

export function splitText(text: string, size: number, overlap: number): string[] {
  if (size <= 0) throw new Error("splitText: size must be greater than 0");
  if (overlap < 0) throw new Error("splitText: overlap must be non-negative");
  if (overlap >= size) throw new Error("splitText: overlap must be less than size");
  if (!text || text.trim().length === 0) return [];
  if (text.length <= size) return [text.trim()];

  const boundaries = [
    { marker: "\n\n", offset: 2 },
    { marker: "。\n", offset: 2 },
    { marker: "。", offset: 1 },
    { marker: ". ", offset: 2 },
    { marker: "? ", offset: 2 },
    { marker: "! ", offset: 2 },
    { marker: "；", offset: 1 },
    { marker: "; ", offset: 2 },
  ];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const searchRegion = text.slice(end - overlap, end);
      let breakPoint = -1;
      for (const { marker, offset } of boundaries) {
        const index = searchRegion.lastIndexOf(marker);
        if (index !== -1) {
          const candidate = end - overlap + index + offset;
          if (candidate > start && candidate > breakPoint) {
            breakPoint = candidate;
          }
        }
      }
      if (breakPoint > start) end = breakPoint;
    }
    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
    if (start < 0) start = 0;
    if (start >= text.length - overlap && end >= text.length) break;
  }

  return chunks.filter((c) => c.length > 0);
}
