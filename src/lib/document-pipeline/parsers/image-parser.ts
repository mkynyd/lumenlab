import crypto from "crypto";
import type { DocumentParser, ParseInput, ParseResult } from "../types";
import { PIPELINE_VERSION } from "../version";
import { analyzeImageWithMiniMax } from "../vision/minimax-analyzer";
import type { MiniMaxImageMedia } from "../vision/minimax-analyzer";
import { extensionOf } from "./utils";

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

function toMiniMaxMediaType(
  mimeType: string,
  filename: string
): MiniMaxImageMedia {
  if (IMAGE_MIME_TYPES.has(mimeType)) {
    return mimeType as MiniMaxImageMedia;
  }

  const ext = extensionOf(filename);
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      throw new Error(`无法识别的图片格式: ${mimeType || ext || filename}`);
  }
}

export class ImageParser implements DocumentParser {
  readonly parserId = "minimax-m3-image";
  readonly sourceKind = "image";

  canParse(input: ParseInput): boolean {
    if (IMAGE_MIME_TYPES.has(input.mimeType)) return true;
    const ext = extensionOf(input.filename);
    return IMAGE_EXTENSIONS.has(ext);
  }

  async parse(input: ParseInput): Promise<ParseResult> {
    const startedAt = new Date().toISOString();

    if (!input.apiKeys.minimax) {
      throw new Error("尚未配置 MiniMax API Key，无法解析图片");
    }

    const mediaType = toMiniMaxMediaType(input.mimeType, input.filename);

    const result = await analyzeImageWithMiniMax({
      apiKey: input.apiKeys.minimax,
      image: {
        type: "base64",
        mediaType,
        data: input.data,
      },
    });

    const analysisText = [result.summary, result.ocrText]
      .filter(Boolean)
      .join("\n\n");

    const endedAt = new Date().toISOString();

    return {
      blocks: [
        {
          type: "text",
          id: crypto.randomUUID(),
          content: analysisText || "无可用解析结果",
        },
      ],
      assets: [],
      metadata: {
        parser: this.parserId,
        pipelineVersion: PIPELINE_VERSION,
        sourceKind: this.sourceKind,
        requiresVisionModel: true,
        assetCount: 0,
        parseStartedAt: startedAt,
        parseCompletedAt: endedAt,
        parseWarnings: result.warnings || [],
      },
    };
  }
}
