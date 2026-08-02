import type {
  DocumentBlock,
  DocumentParser,
  ImageBlock,
  ParseInput,
  ParseResult,
  ParsedAsset,
  ProgressCallback,
} from "./types";
import { renderDocumentToMarkdown } from "./renderer";
import { filterImagesForAnalysis, inferImageMode } from "./image-filter";
import { analyzeImageWithMiniMax } from "./vision/minimax-analyzer";
import type { MiniMaxImageMedia } from "./vision/minimax-analyzer";
import { analyzeImageWithQwen } from "./vision/qwen-analyzer";
import { MiniMaxError } from "@/lib/vision/minimax";
import { TextLocalParser } from "./parsers/text-local-parser";
import { MinerUParser } from "./parsers/mineru-parser";
import { MiniMaxPdfParser } from "./parsers/minimax-pdf-parser";
import { ImageParser } from "./parsers/image-parser";
import { extensionOf, MAX_MINERU_FILE_BYTES } from "./parsers/utils";
import { buildParseQualityReport } from "./quality-checker";

export interface PipelineResult {
  content: string;
  status: "parsed";
  metadata: ParseResult["metadata"];
  blocks: DocumentBlock[];
  assets: ParsedAsset[];
}

export class DocumentPipeline {
  private parsers: DocumentParser[] = [
    new ImageParser(),
    new TextLocalParser(),
    new MinerUParser(),
    new MiniMaxPdfParser(),
  ];

  async run(input: ParseInput, onProgress?: ProgressCallback): Promise<PipelineResult> {
    const startedAt = new Date().toISOString();

    const parser = this.parsers.find((p) => p.canParse(input));
    if (!parser) {
      const ext = extensionOf(input.filename);
      const isPdf = ext === "pdf" || input.mimeType === "application/pdf";
      if (isPdf && input.data.length > MAX_MINERU_FILE_BYTES) {
        throw new Error("PDF 文件超过 200MB 解析上限，请压缩或拆分后重试");
      }
      throw new Error(`不支持的文件类型: .${ext || input.mimeType}`);
    }

    const parseResult = await this.parseWithFallback(parser, input, onProgress);

    if (
      parseResult.assets.length > 0 &&
      (input.apiKeys.bailian || input.apiKeys.minimax) &&
      parseResult.metadata.requiresVisionModel
    ) {
      await this.analyzeImages(parseResult, input, onProgress);
    }

    const content = renderDocumentToMarkdown(parseResult.blocks);
    const completedAt = new Date().toISOString();

    // 覆盖率分子是渲染文本的字符数，分母必须同单位：文本文件按 UTF-8
    // 解码后的字符数计算，否则中文（每字 3 字节）的覆盖率会被低估约三倍，
    // 无法达到 0.5 的门槛；二进制（PDF/图片）保持字节数作为启发式基准。
    const originalSize =
      parser instanceof TextLocalParser
        ? input.data.toString("utf8").length
        : input.data.length;

    const qualityReport = buildParseQualityReport({
      blocks: parseResult.blocks,
      assets: parseResult.assets,
      content,
      metadata: parseResult.metadata,
      originalSize,
    });

    return {
      content,
      status: "parsed",
      metadata: {
        ...parseResult.metadata,
        parseStartedAt: startedAt,
        parseCompletedAt: completedAt,
        parseReport: qualityReport,
      },
      blocks: parseResult.blocks,
      assets: parseResult.assets,
    };
  }

  /**
   * MiniMax PDF 解析被端点以请求过大/格式无效（400/413）拒绝时，
   * 在 MinerU 可用且文件不超过其 200MB 上限的前提下回退到 MinerU 重试一次。
   */
  private async parseWithFallback(
    parser: DocumentParser,
    input: ParseInput,
    onProgress?: ProgressCallback
  ): Promise<ParseResult> {
    try {
      return await parser.parse(input, onProgress);
    } catch (error) {
      const canFallback =
        parser instanceof MiniMaxPdfParser &&
        error instanceof MiniMaxError &&
        (error.status === 400 || error.status === 413) &&
        Boolean(input.apiKeys.mineru) &&
        input.data.length <= MAX_MINERU_FILE_BYTES;
      if (!canFallback) throw error;

      const message = error instanceof Error ? error.message : String(error);
      const fallbackResult = await new MinerUParser().parse(input, onProgress);
      fallbackResult.metadata.parseWarnings.push(
        `MiniMax PDF 解析失败（${message}），已回退到 MinerU 解析`
      );
      return fallbackResult;
    }
  }

  private async analyzeImages(
    parseResult: ParseResult,
    input: ParseInput,
    onProgress?: ProgressCallback
  ): Promise<void> {
    const imageBlocks = parseResult.blocks.filter(
      (b): b is ImageBlock => b.type === "image"
    );
    if (imageBlocks.length === 0) return;

    const { retained, skipped } = filterImagesForAnalysis(
      imageBlocks,
      parseResult.assets
    );

    for (const { block, reason } of skipped) {
      block.analysisStatus = "skipped";
      block.skipReason = reason;
    }

    const assetMap = new Map(parseResult.assets.map((a) => [a.id, a]));
    const analyzed = new Set<string>();

    for (let i = 0; i < retained.length; i++) {
      const block = retained[i];
      const asset = assetMap.get(block.assetId);
      if (!asset || analyzed.has(asset.sha256)) continue;
      analyzed.add(asset.sha256);

      onProgress?.("analyzing-images", {
        current: i + 1,
        total: retained.length,
      });

      try {
        const mode = inferImageMode(block);
        const image = {
          type: "base64" as const,
          mediaType: asset.mimeType as MiniMaxImageMedia,
          data: asset.buffer,
        };
        const result = input.apiKeys.bailian
          ? await analyzeImageWithQwen({
              apiKey: input.apiKeys.bailian,
              image,
              mode,
            })
          : await analyzeImageWithMiniMax({
              apiKey: input.apiKeys.minimax!,
              image,
              mode,
            });

        block.visionSummary = result.summary;
        block.visionText = result.ocrText;
        block.extractedText = result.ocrText;
        block.confidence = result.confidence;
        block.analysisStatus = "parsed";
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "视觉分析失败";
        block.analysisStatus = "failed";
        block.skipReason = message;
        parseResult.metadata.parseWarnings.push(
          `图片 ${block.relativePath} 分析失败: ${message.slice(0, 120)}`
        );
      }
    }

    if (skipped.length > 0) {
      parseResult.metadata.parseWarnings.push(`${skipped.length} 张图片被跳过`);
    }
  }
}
