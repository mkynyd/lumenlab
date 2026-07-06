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
import type { ImageAnalysisMode } from "./vision/minimax-analyzer";
import { TextLocalParser } from "./parsers/text-local-parser";
import { MinerUParser } from "./parsers/mineru-parser";
import { MiniMaxPdfParser } from "./parsers/minimax-pdf-parser";
import { extensionOf } from "./parsers/utils";

export interface PipelineResult {
  content: string;
  status: "parsed";
  metadata: ParseResult["metadata"];
  blocks: DocumentBlock[];
  assets: ParsedAsset[];
}

export class DocumentPipeline {
  private parsers: DocumentParser[] = [
    new TextLocalParser(),
    new MinerUParser(),
    new MiniMaxPdfParser(),
  ];

  async run(input: ParseInput, onProgress?: ProgressCallback): Promise<PipelineResult> {
    const startedAt = new Date().toISOString();

    const parser = this.parsers.find((p) => p.canParse(input));
    if (!parser) {
      const ext = extensionOf(input.filename);
      throw new Error(`不支持的文件类型: .${ext || input.mimeType}`);
    }

    const parseResult = await parser.parse(input, onProgress);

    if (parseResult.assets.length > 0 && input.apiKeys.minimax) {
      await this.analyzeImages(parseResult, input, onProgress);
    }

    const content = renderDocumentToMarkdown(parseResult.blocks);
    const completedAt = new Date().toISOString();

    return {
      content,
      status: "parsed",
      metadata: {
        ...parseResult.metadata,
        parseStartedAt: startedAt,
        parseCompletedAt: completedAt,
      },
      blocks: parseResult.blocks,
      assets: parseResult.assets,
    };
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
        const resourceUrl = `/api/files/${input.fileAssetId}/resources/${asset.id}`;
        const result = await analyzeImageWithMiniMax({
          apiKey: input.apiKeys.minimax!,
          image: { type: "url", url: resourceUrl },
          mode: inferImageMode(block) as ImageAnalysisMode,
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
