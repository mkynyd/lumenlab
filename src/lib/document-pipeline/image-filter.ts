import type { ImageAnalysisMode } from "./vision/minimax-analyzer";
import type { ImageBlock, ParsedAsset } from "@/lib/document-pipeline/types";

export interface ImageFilterResult {
  retained: ImageBlock[];
  skipped: Array<{ block: ImageBlock; reason: string }>;
}

export interface ImageFilterOptions {
  minBytes?: number;
  minWidth?: number;
  minHeight?: number;
  retainMinBytes?: number;
}

const SUPPORTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const DEFAULT_MIN_BYTES = 2 * 1024;
const DEFAULT_MIN_WIDTH = 120;
const DEFAULT_MIN_HEIGHT = 120;
const DEFAULT_RETAIN_MIN_BYTES = 50 * 1024;

const DECORATIVE_PATTERNS = [
  "logo",
  "watermark",
  "header",
  "footer",
  "icon",
  "decoration",
  "页眉",
  "页脚",
  "水印",
];

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * Parse PNG dimensions from the IHDR chunk.
 * Returns null for non-PNG inputs or malformed PNGs.
 */
function parsePngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < PNG_SIGNATURE.length + 8 + 13) {
    return null;
  }

  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return null;
  }

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);

    if (type === "IHDR") {
      if (offset + 8 + length > buffer.length) {
        return null;
      }
      const width = buffer.readUInt32BE(offset + 8);
      const height = buffer.readUInt32BE(offset + 12);
      return { width, height };
    }

    if (length > 0x7fffffff) {
      return null;
    }

    offset += 12 + length;
  }

  return null;
}

function hasContentHint(block: ImageBlock): boolean {
  return Boolean(
    block.altText?.trim() ||
      block.surroundingText?.trim() ||
      block.visionText?.trim() ||
      block.visionSummary?.trim() ||
      block.extractedText?.trim()
  );
}

function isDecorative(block: ImageBlock): boolean {
  const haystack = [
    block.relativePath,
    block.altText ?? "",
    block.surroundingText ?? "",
    block.visionText ?? "",
    block.visionSummary ?? "",
    block.extractedText ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return DECORATIVE_PATTERNS.some((pattern) => haystack.includes(pattern.toLowerCase()));
}

export function inferImageMode(block: ImageBlock): ImageAnalysisMode {
  const haystack = [
    block.relativePath,
    block.altText ?? "",
    block.surroundingText ?? "",
    block.visionText ?? "",
    block.visionSummary ?? "",
    block.extractedText ?? "",
  ]
    .join(" ")
    .toLowerCase();

  if (
    /\b(chart|graph)\b/.test(haystack) ||
    /趋势|折线|柱状|饼图/.test(haystack)
  ) {
    return "chart";
  }

  if (/\b(diagram|flow)\b/.test(haystack) || /流程图|架构/.test(haystack)) {
    return "diagram";
  }

  if (/\b(code|snippet)\b/.test(haystack) || /截图/.test(haystack)) {
    return "code";
  }

  if (
    /\b(formula|equation)\b/.test(haystack) ||
    /公式|题目|quiz|手写/.test(haystack)
  ) {
    return "ocr";
  }

  if (/\bexperiment\b|实验/.test(haystack)) {
    return "general";
  }

  return "general";
}

export function filterImagesForAnalysis(
  blocks: ImageBlock[],
  assets: ParsedAsset[],
  options: ImageFilterOptions = {}
): ImageFilterResult {
  const minBytes = options.minBytes ?? DEFAULT_MIN_BYTES;
  const minWidth = options.minWidth ?? DEFAULT_MIN_WIDTH;
  const minHeight = options.minHeight ?? DEFAULT_MIN_HEIGHT;
  const retainMinBytes = options.retainMinBytes ?? DEFAULT_RETAIN_MIN_BYTES;

  const assetMap = new Map(assets.map((a) => [a.id, a]));

  const retained: ImageBlock[] = [];
  const skipped: Array<{ block: ImageBlock; reason: string }> = [];
  const seenSha256 = new Set<string>();

  for (const block of blocks) {
    if (block.analysisStatus !== "pending") {
      skipped.push({
        block,
        reason: `analysis status ${block.analysisStatus} is not pending`,
      });
      continue;
    }

    const asset = assetMap.get(block.assetId);
    if (!asset) {
      skipped.push({ block, reason: "missing asset" });
      continue;
    }

    if (!SUPPORTED_MIME_TYPES.has(asset.mimeType)) {
      skipped.push({ block, reason: `unsupported mime type: ${asset.mimeType}` });
      continue;
    }

    if (asset.buffer.length < minBytes) {
      skipped.push({
        block,
        reason: `byte size ${asset.buffer.length} below minimum ${minBytes}`,
      });
      continue;
    }

    const dimensions =
      asset.mimeType === "image/png" ? parsePngDimensions(asset.buffer) : null;

    if (dimensions && (dimensions.width < minWidth || dimensions.height < minHeight)) {
      skipped.push({
        block,
        reason: `dimensions ${dimensions.width}x${dimensions.height} below minimum ${minWidth}x${minHeight}`,
      });
      continue;
    }

    if (isDecorative(block)) {
      skipped.push({ block, reason: "decorative image" });
      continue;
    }

    if (seenSha256.has(asset.sha256)) {
      skipped.push({ block, reason: `duplicate sha256: ${asset.sha256}` });
      continue;
    }
    seenSha256.add(asset.sha256);

    const mode = inferImageMode(block);
    if (
      mode === "general" &&
      !hasContentHint(block) &&
      asset.buffer.length < retainMinBytes &&
      !dimensions
    ) {
      skipped.push({
        block,
        reason: `no content hint and byte size ${asset.buffer.length} below retain minimum ${retainMinBytes}`,
      });
      continue;
    }

    retained.push(block);
  }

  return { retained, skipped };
}
