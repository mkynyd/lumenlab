import type { DocumentBlock, ImageBlock, ParsedAsset, ParsingMetadata } from "./types";

export interface ParseQualityReport {
  textCoverageRatio: number;
  imageRetainedCount: number;
  imageAnalyzedCount: number;
  imageSkippedCount: number;
  failedImageCount: number;
  tableCount: number;
  formulaCount: number;
  warningCount: number;
  estimatedCost?: number;
  actualTokenUsage?: number;
  checks: Array<{ rule: string; passed: boolean; message?: string }>;
}

export interface BuildReportOptions {
  blocks: DocumentBlock[];
  assets: ParsedAsset[];
  content: string;
  metadata: ParsingMetadata;
  usage?: { inputTokens: number; outputTokens: number };
  originalSize?: number;
}

export function buildParseQualityReport(options: BuildReportOptions): ParseQualityReport {
  const { blocks, content, metadata, usage, originalSize } = options;

  const images = blocks.filter((b): b is ImageBlock => b.type === "image");
  const imageRetainedCount = images.length;
  const imageAnalyzedCount = images.filter((i) => i.analysisStatus === "parsed").length;
  const imageSkippedCount = images.filter((i) => i.analysisStatus === "skipped").length;
  const failedImageCount = images.filter((i) => i.analysisStatus === "failed").length;
  const tableCount = blocks.filter((b) => b.type === "table").length;
  const formulaCount = blocks.filter((b) => b.type === "formula").length;

  const textBlocks = blocks.filter((b) => b.type === "text" || b.type === "heading");
  const renderedTextLength = textBlocks.reduce(
    (sum, b) => sum + ("content" in b ? b.content.length : 0),
    0
  );
  const textCoverageRatio = originalSize && originalSize > 0
    ? renderedTextLength / originalSize
    : 1;

  const checks: ParseQualityReport["checks"] = [];

  checks.push({
    rule: "non_empty_content",
    passed: content.trim().length > 0,
    message: content.trim().length === 0 ? "解析结果为空" : undefined,
  });

  checks.push({
    rule: "images_analyzed_when_present",
    passed: imageRetainedCount === 0 || imageAnalyzedCount > 0,
    message:
      imageRetainedCount > 0 && imageAnalyzedCount === 0
        ? "文档包含图片但没有任何图片完成视觉分析"
        : undefined,
  });

  checks.push({
    rule: "image_references_resolved",
    passed: !content.includes("](pics/"),
    message: content.includes("](pics/")
      ? "Markdown 中仍存在未重写的图片引用"
      : undefined,
  });

  checks.push({
    rule: "reasonable_content_length",
    passed: originalSize === undefined || content.length >= 100 || originalSize <= 10 * 1024,
    message:
      originalSize !== undefined && content.length < 100 && originalSize > 10 * 1024
        ? "大文件解析出的内容过短，可能存在解析失败"
        : undefined,
  });

  const lowConfidencePassed = !images.some(
    (i) =>
      i.analysisStatus === "parsed" &&
      (i.confidence ?? 1) < 0.7 &&
      ["chart", "diagram"].some((k) =>
        (i.relativePath + " " + (i.altText || "")).includes(k)
      )
  );
  checks.push({
    rule: "low_confidence_images_flagged",
    passed: lowConfidencePassed,
    message: lowConfidencePassed ? undefined : "低置信度图表/流程图，建议核对数字和标签",
  });

  const warningCount = metadata.parseWarnings.length + checks.filter((c) => !c.passed).length;

  return {
    textCoverageRatio,
    imageRetainedCount,
    imageAnalyzedCount,
    imageSkippedCount,
    failedImageCount,
    tableCount,
    formulaCount,
    warningCount,
    actualTokenUsage: usage ? usage.inputTokens + usage.outputTokens : undefined,
    checks,
  };
}
