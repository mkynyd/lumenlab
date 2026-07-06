import crypto from "crypto";
import { parseFileWithMinerU } from "@/lib/parse/mineru";
import type { DocumentParser, ParseInput, ParseResult, ParsedAsset } from "../types";
import { PIPELINE_VERSION } from "../version";
import { extensionOf } from "./utils";
import { assignAssetIdsToImageBlocks, markdownToBlocks } from "./markdown-to-blocks";

export class MinerUParser implements DocumentParser {
  readonly parserId = "mineru-office";
  readonly sourceKind = "office";

  private readonly officeExtensions = new Set([
    "ppt",
    "pptx",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "wps",
    "et",
    "dps",
    "pages",
    "numbers",
    "key",
  ]);

  canParse(input: ParseInput): boolean {
    const ext = extensionOf(input.filename);
    return this.officeExtensions.has(ext);
  }

  async parse(
    input: ParseInput,
    onProgress?: (stage: string, progress?: { current: number; total: number }) => void
  ): Promise<ParseResult> {
    const startedAt = new Date().toISOString();

    if (!input.apiKeys.mineru) {
      throw new Error("尚未配置 MinerU Token，Office 文件无法解析");
    }

    const parsed = await parseFileWithMinerU({
      token: input.apiKeys.mineru,
      fileBuffer: input.data,
      filename: input.filename,
      onProgress,
    });

    const assets: ParsedAsset[] = parsed.assets.map((asset) => ({
      id: crypto.randomUUID(),
      relativePath: asset.relativePath,
      mimeType: asset.mimeType,
      buffer: asset.buffer,
      sha256: crypto.createHash("sha256").update(asset.buffer).digest("hex"),
    }));

    const assetMap = new Map(assets.map((asset) => [asset.relativePath, asset]));
    const blocks = markdownToBlocks(parsed.content);
    assignAssetIdsToImageBlocks(blocks, assetMap);

    const warnings: string[] = [];
    for (const block of blocks) {
      if (block.type === "image" && !block.assetId) {
        block.analysisStatus = "skipped";
        block.skipReason = "asset-missing";
        warnings.push(`图片引用未找到资源: ${block.relativePath}`);
      }
    }

    const endedAt = new Date().toISOString();

    return {
      blocks,
      assets,
      metadata: {
        ...parsed.metadata,
        parser: this.parserId,
        pipelineVersion: PIPELINE_VERSION,
        sourceKind: this.sourceKind,
        requiresVisionModel: Boolean(parsed.metadata?.requiresVisionModel) || assets.length > 0,
        assetCount: assets.length,
        parseStartedAt: startedAt,
        parseCompletedAt: endedAt,
        parseWarnings: warnings,
      },
    };
  }

}
