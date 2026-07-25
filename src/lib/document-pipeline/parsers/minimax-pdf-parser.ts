import { parseDocumentWithMiniMax } from "@/lib/vision/minimax";
import type { DocumentParser, ParseInput, ParseResult } from "../types";
import { PIPELINE_VERSION } from "../version";
import { markdownToBlocks } from "./markdown-to-blocks";
import { MAX_MINIMAX_PDF_BYTES } from "./utils";

export class MiniMaxPdfParser implements DocumentParser {
  readonly parserId = "minimax-m3-pdf";
  readonly sourceKind = "pdf";

  canParse(input: ParseInput): boolean {
    const ext = input.filename.toLowerCase().endsWith(".pdf");
    const mime = input.mimeType === "application/pdf";
    // 超过 MiniMax 端点单请求上限的大 PDF 交给 MinerUParser
    return (ext || mime) && input.data.length <= MAX_MINIMAX_PDF_BYTES;
  }

  async parse(
    input: ParseInput,
    onProgress?: (stage: string, progress?: { current: number; total: number }) => void
  ): Promise<ParseResult> {
    const startedAt = new Date().toISOString();

    if (!input.apiKeys.minimax) {
      throw new Error("尚未配置 MiniMax API Key，请先在设置中添加");
    }

    onProgress?.("model");
    const content = await parseDocumentWithMiniMax({
      apiKey: input.apiKeys.minimax,
      data: input.data,
      filename: input.filename,
      mediaType: "application/pdf",
    });

    const blocks = markdownToBlocks(content);
    for (const block of blocks) {
      if (block.type === "image") {
        block.analysisStatus = "skipped";
        block.skipReason = "minimax-document-embedded";
      }
    }

    const endedAt = new Date().toISOString();

    return {
      blocks,
      assets: [],
      metadata: {
        parser: this.parserId,
        pipelineVersion: PIPELINE_VERSION,
        sourceKind: this.sourceKind,
        requiresVisionModel: true,
        assetCount: 0,
        parseStartedAt: startedAt,
        parseCompletedAt: endedAt,
        parseWarnings: [],
      },
    };
  }
}
