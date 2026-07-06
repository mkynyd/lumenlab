import Anthropic from "@anthropic-ai/sdk";
import { cacheExperiments } from "@/lib/cache/experiment-config";
import { applyActiveCache } from "@/lib/cache/minimax-active-cache";
import { MiniMaxError } from "@/lib/vision/minimax";

const MINIMAX_BASE_URL = "https://api.minimaxi.com/anthropic";

export type ImageAnalysisMode =
  | "ocr"
  | "chart"
  | "diagram"
  | "code"
  | "general";

export type ImageDetail = "low" | "default" | "high";

export type MiniMaxImageMedia = "image/png" | "image/jpeg" | "image/webp";

export interface AnalyzeImageOptions {
  apiKey: string;
  image:
    | { type: "url"; url: string }
    | { type: "base64"; mediaType: MiniMaxImageMedia; data: Buffer };
  mode?: ImageAnalysisMode;
  detail?: ImageDetail;
  thinking?: "disabled" | "adaptive";
  context?: string;
  pageLabel?: string;
}

export interface ImageAnalysisResult {
  summary: string;
  ocrText: string;
  structured?: {
    kind?: string;
    title?: string;
    axes?: string[];
    legend?: string[];
    dataPoints?: unknown[];
    relationships?: string[];
  };
  confidence: number;
  warnings: string[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

const BASE_PROMPT = `你是大学课程资料的视觉转录工具。请忠实提取图片中的可见内容并输出结构化结果。只描述和转录，不解题，不写实验报告，不补全看不清的数据。看不清或缺失的内容统一标记为 [无法识别]。保留原始语言、数字、单位、代码缩进和表格关系。`;

const MODE_INSTRUCTIONS: Record<ImageAnalysisMode, string> = {
  ocr: "重点提取图中所有可见文字，包括题号、选项、手写标注和数字。",
  chart: "提取图表标题、坐标轴、单位、图例、数据点和整体趋势。",
  diagram: "提取流程图或架构图中的实体、关系、箭头方向、阶段和标签。",
  code: "提取代码截图中的所有代码，保留缩进、换行和语言特征。",
  general: "给出图片整体摘要，并提取图中可见文字和关键信息。",
};

const JSON_FORMAT_PROMPT = `输出必须是 JSON 格式，不要包含其他解释文字。JSON 字段：
- summary: 图片整体摘要（字符串）
- ocrText: 图中提取的文字（字符串）
- structured: 结构化对象（可选）
- confidence: 0-1 之间的置信度（数字）
- warnings: 识别警告数组（字符串数组）`;

export function selectImageDetail(
  mode: ImageAnalysisMode,
  explicit?: ImageDetail
): ImageDetail {
  if (explicit) return explicit;
  if (mode === "code") return "high";
  if (mode === "ocr") return "low";
  return "default";
}

export function selectImageThinking(
  mode: ImageAnalysisMode,
  explicit?: "disabled" | "adaptive"
): "disabled" | "adaptive" {
  if (explicit) return explicit;
  if (mode === "diagram" || mode === "chart") return "adaptive";
  return "disabled";
}

function buildSystemPrompt(mode: ImageAnalysisMode): string {
  return [BASE_PROMPT, MODE_INSTRUCTIONS[mode], JSON_FORMAT_PROMPT].join("\n\n");
}

function buildUserText(
  mode: ImageAnalysisMode,
  context?: string,
  pageLabel?: string
): string {
  const parts: string[] = [];
  if (pageLabel) {
    parts.push(`请解析 ${pageLabel}。`);
  } else {
    parts.push("请解析这张图片。");
  }
  if (context) {
    parts.push(`上下文：${context}`);
  }
  parts.push(`解析模式：${mode}。`);
  return parts.join("\n");
}

function parseAnalysisResponse(text: string): ImageAnalysisResult {
  const cleaned = text.trim();
  const fenced = cleaned.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const jsonText = fenced || cleaned;

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return {
      summary: String(parsed.summary || ""),
      ocrText: String(parsed.ocrText || ""),
      structured:
        parsed.structured && typeof parsed.structured === "object"
          ? (parsed.structured as ImageAnalysisResult["structured"])
          : undefined,
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      warnings: Array.isArray(parsed.warnings)
        ? parsed.warnings.map(String)
        : [],
    };
  } catch {
    return {
      summary: cleaned,
      ocrText: cleaned,
      confidence: 0.5,
      warnings: ["模型未返回 JSON，已按纯文本处理"],
    };
  }
}

export async function analyzeImageWithMiniMax(
  options: AnalyzeImageOptions
): Promise<ImageAnalysisResult> {
  const mode = options.mode || "general";
  const detail = selectImageDetail(mode, options.detail);
  const thinking = selectImageThinking(mode, options.thinking);

  const client = new Anthropic({
    baseURL: MINIMAX_BASE_URL,
    apiKey: options.apiKey,
    timeout: 120_000,
    maxRetries: 0,
  });

  const imageContent: Anthropic.ContentBlockParam = {
    type: "image",
    source:
      options.image.type === "url"
        ? { type: "url", url: options.image.url }
        : {
            type: "base64",
            media_type: options.image.mediaType,
            data: options.image.data.toString("base64"),
          },
  };

  // The Anthropic SDK type may not yet expose `detail` on image sources.
  // Cast through `unknown` to attach the MiniMax-specific field.
  ((imageContent.source as unknown) as Record<string, unknown>).detail = detail;

  const requestBody: Anthropic.MessageCreateParamsNonStreaming = {
    model: "MiniMax-M3",
    max_tokens: 4096,
    temperature: 0.2,
    thinking: { type: thinking },
    system: buildSystemPrompt(mode),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildUserText(mode, options.context, options.pageLabel),
          },
          imageContent,
        ],
      },
    ],
  };

  try {
    const response = await client.messages.create(
      applyActiveCache(requestBody, cacheExperiments.minimaxActiveCache)
    );

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) {
      throw new MiniMaxError(502, "MiniMax 未返回可用的解析内容");
    }

    const result = parseAnalysisResponse(text);
    const usage = response.usage;
    if (usage) {
      result.usage = {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.input_tokens + usage.output_tokens,
      };
    }
    return result;
  } catch (error) {
    if (error instanceof MiniMaxError) throw error;
    if (error instanceof Anthropic.APIError) {
      const messages: Record<number, string> = {
        400: "MiniMax 请求格式无效",
        401: "MiniMax API Key 无效，请在设置中更新",
        413: "图片或请求体超过 MiniMax 限制",
        429: "MiniMax 请求频率过高，请稍后重试",
        500: "MiniMax 服务异常，请稍后重试",
        529: "MiniMax 服务过载，请稍后重试",
      };
      throw new MiniMaxError(
        error.status,
        messages[error.status] || `MiniMax API 错误 (${error.status})`
      );
    }
    throw new MiniMaxError(502, "无法连接 MiniMax API，请稍后重试");
  }
}
