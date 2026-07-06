import Anthropic from "@anthropic-ai/sdk";
import { cacheExperiments } from "@/lib/cache/experiment-config";
import { applyActiveCache } from "@/lib/cache/minimax-active-cache";

const MINIMAX_BASE_URL = "https://api.minimaxi.com/anthropic";

const VISION_PROMPT = `你是大学课程资料的视觉转录工具。请忠实提取图片中的可见内容并输出 Markdown。

必须提取：文字、标题层级、表格、公式、代码、图表坐标轴、单位、题号、选项、实验数据和手写标注。
只描述和转录，不解题，不写实验报告，不补全看不清的数据。
看不清或缺失的内容统一标记为 [无法识别]。
保留原始语言、数字、单位、代码缩进和表格关系。`;

const DOCUMENT_PROMPT = `你是大学课程资料的文档解析工具。请读取用户提供的文档并输出忠实 Markdown。

必须提取：标题层级、正文、表格、公式、代码、图表文字、题号、选项、实验数据、页码线索和注释。
只转录和整理文档内容，不解题，不补全缺失数据，不生成实验报告。
看不清或缺失的内容统一标记为 [无法识别]。
保留原始语言、数字、单位、代码缩进和表格关系。`;

export class MiniMaxError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "MiniMaxError";
  }
}

export function mapAnthropicErrorToMiniMaxError(
  error: InstanceType<typeof Anthropic.APIError>,
  context?: string
): MiniMaxError {
  const status = error.status ?? 502;
  const messages: Record<number, string> = {
    400: context
      ? `MiniMax ${context}请求格式无效`
      : "MiniMax 请求格式无效",
    401: "MiniMax API Key 无效，请在设置中更新",
    413: context
      ? `${context}或请求体超过 MiniMax 限制`
      : "请求体超过 MiniMax 限制",
    429: "MiniMax 请求频率过高，请稍后重试",
    500: "MiniMax 服务异常，请稍后重试",
    529: "MiniMax 服务过载，请稍后重试",
  };
  return new MiniMaxError(
    status,
    messages[status] || `MiniMax API 错误 (${status})`
  );
}

export async function parseImageWithMiniMax(options: {
  apiKey: string;
  data: Buffer;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  pageLabel?: string;
}): Promise<string> {
  const client = new Anthropic({
    baseURL: MINIMAX_BASE_URL,
    apiKey: options.apiKey,
    timeout: 120_000,
    maxRetries: 0,
  });

  try {
    const requestBody: Anthropic.MessageCreateParamsNonStreaming = {
      model: "MiniMax-M3",
      max_tokens: 4096,
      temperature: 0.2,
      thinking: { type: "disabled" },
      system: VISION_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: options.pageLabel
                ? `请解析 ${options.pageLabel}。`
                : "请解析这张图片。",
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: options.mediaType,
                data: options.data.toString("base64"),
              },
            },
          ],
        },
      ],
    };
    const response = await client.messages.create(
      applyActiveCache(requestBody, cacheExperiments.minimaxActiveCache)
    );

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text) throw new MiniMaxError(502, "MiniMax 未返回可用的解析内容");
    return text;
  } catch (error) {
    if (error instanceof MiniMaxError) throw error;
    if (error instanceof Anthropic.APIError) {
      throw mapAnthropicErrorToMiniMaxError(error, "图片");
    }
    throw new MiniMaxError(502, "无法连接 MiniMax API，请稍后重试");
  }
}

export async function parseDocumentWithMiniMax(options: {
  apiKey: string;
  data: Buffer;
  filename: string;
  mediaType: string;
}): Promise<string> {
  const client = new Anthropic({
    baseURL: MINIMAX_BASE_URL,
    apiKey: options.apiKey,
    timeout: 300_000,
    maxRetries: 0,
  });

  try {
    const requestBody: Anthropic.MessageCreateParamsNonStreaming = {
      model: "MiniMax-M3",
      max_tokens: 16384,
      temperature: 0.2,
      thinking: { type: "disabled" },
      system: DOCUMENT_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `请解析文档 ${options.filename}，输出可直接检索和引用的 Markdown。`,
            },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: options.mediaType,
                data: options.data.toString("base64"),
              },
            } as never,
          ],
        },
      ],
    };
    const response = await client.messages.create(
      applyActiveCache(requestBody, cacheExperiments.minimaxActiveCache)
    );

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text) throw new MiniMaxError(502, "MiniMax 未返回可用的解析内容");
    return text;
  } catch (error) {
    if (error instanceof MiniMaxError) throw error;
    if (error instanceof Anthropic.APIError) {
      throw mapAnthropicErrorToMiniMaxError(error, "文档");
    }
    throw new MiniMaxError(502, "无法连接 MiniMax API，请稍后重试");
  }
}
